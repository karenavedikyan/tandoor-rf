import type {
  ManagerAssignmentState,
  ParsedManagerRef,
  ParsedRetailOutlet,
} from "../onec-clients/extended-types";
import { shortUuidLabel } from "./uuid-param";

export type ManagerRefDto = {
  displayName: string;
  shortId: string | null;
  assignmentState: ManagerAssignmentState;
  assignmentLabel: string;
};

export type RetailOutletAddressDto = {
  storeAddress: string;
  deliveryAddress: string;
  routeDirection: string;
};

export type RetailOutletLoadingDto = {
  days: Array<{ key: string; label: string; value: boolean | null }>;
  loadingTime: string | null;
  loadingEndTime: null;
};

export type RetailOutletManagersDto = {
  manager: ManagerRefDto;
  regionalManager: ManagerRefDto;
  hardwareManager: ManagerRefDto;
  headOfSales: ManagerRefDto;
};

export type RetailOutletContactsDto = {
  storePhone: string;
  accountantPhone: string;
  accountantEmail: string;
};

export type RetailOutletDto = {
  ordinal: number;
  holdingName: string;
  identityLabel: string;
  closureStatusLabel: string;
  warehouse: boolean | null;
  warehouseLabel: string;
  addresses: RetailOutletAddressDto;
  loading: RetailOutletLoadingDto;
  managers: RetailOutletManagersDto;
  contacts: RetailOutletContactsDto;
  distributionAllowed: false;
  presentInCurrentSnapshot: boolean;
  staleLabel: string | null;
};

export type ClientExtendedManagersDto = {
  regionalManager: ManagerRefDto;
  hardwareManager: ManagerRefDto;
  headOfSales: ManagerRefDto;
};

export type ClientExtendedDto = {
  formatVersion: string;
  sourceSha256: string | null;
  isHolding: boolean | null;
  holdingCardLabel: string | null;
  managers: ClientExtendedManagersDto;
  retailOutlets: RetailOutletDto[];
  dataQualityLabel: string;
  sensitiveFieldsWithheld: true;
  outletNormalizedReady: false;
};

type LoadingDayField = Exclude<keyof ParsedRetailOutlet["loading"], "loadingTime">;
const DAY_LABELS: Array<[LoadingDayField, string, string]> = [
  ["loadingOnMonday", "mon", "Пн"],
  ["loadingOnTuesday", "tue", "Вт"],
  ["loadingOnWednesday", "wed", "Ср"],
  ["loadingOnThursday", "thu", "Чт"],
  ["loadingOnFriday", "fri", "Пт"],
  ["loadingOnSaturday", "sat", "Сб"],
  ["loadingOnSunday", "sun", "Вс"],
];

function managerAssignmentLabel(ref: ParsedManagerRef): string {
  if (ref.state === "unassigned") {
    return "Не назначен";
  }
  if (ref.state === "unmatched") {
    return ref.name.trim().length > 0 ? `${ref.name.trim()} · Сотрудник не сопоставлен` : "Сотрудник не сопоставлен";
  }
  if (ref.state === "invalid") {
    return "Некорректный идентификатор";
  }
  return ref.name.trim().length > 0 ? ref.name.trim() : "—";
}

function toManagerRefDto(ref: ParsedManagerRef): ManagerRefDto {
  return {
    displayName: ref.name.trim().length > 0 ? ref.name.trim() : "—",
    shortId: ref.guid ? shortUuidLabel(ref.guid) : null,
    assignmentState: ref.state,
    assignmentLabel: managerAssignmentLabel(ref),
  };
}

function toLoadingDto(outlet: ParsedRetailOutlet): RetailOutletLoadingDto {
  return {
    days: DAY_LABELS.map(([field, key, label]) => ({
      key,
      label,
      value: outlet.loading[field],
    })),
    loadingTime: outlet.loading.loadingTime,
    loadingEndTime: null,
  };
}

function toOutletDto(outlet: ParsedRetailOutlet): RetailOutletDto {
  const warehouseLabel =
    outlet.warehouse === true
      ? "Используется как склад"
      : outlet.warehouse === false
        ? "Не используется как склад"
        : "Признак склада не передан";

  return {
    ordinal: outlet.ordinal,
    holdingName: outlet.holdingName,
    identityLabel: "Точка из выгрузки 1С. Идентификатор ещё не передан",
    closureStatusLabel: "Статус не передан",
    warehouse: outlet.warehouse,
    warehouseLabel,
    addresses: {
      storeAddress: outlet.address.storeAddress,
      deliveryAddress: outlet.address.deliveryAddress,
      routeDirection: outlet.address.routeDirection,
    },
    loading: toLoadingDto(outlet),
    managers: {
      manager: toManagerRefDto(outlet.managers.manager),
      regionalManager: toManagerRefDto(outlet.managers.regionalManager),
      hardwareManager: toManagerRefDto(outlet.managers.hardwareManager),
      headOfSales: toManagerRefDto(outlet.managers.headOfSales),
    },
    contacts: {
      storePhone: outlet.contacts.storePhone,
      accountantPhone: outlet.contacts.accountantPhone,
      accountantEmail: outlet.contacts.accountantEmail,
    },
    distributionAllowed: false,
    presentInCurrentSnapshot: outlet.presentInCurrentSnapshot,
    staleLabel: outlet.presentInCurrentSnapshot
      ? null
      : "Отсутствует в текущем снимке; данные сохранены для сверки",
  };
}

type ExtendedRow = {
  is_holding: boolean | null;
  extended_format_version: string | null;
  extended_source_sha256: string | null;
  extended_snapshot: unknown;
};

export function toClientExtendedDto(row: ExtendedRow): ClientExtendedDto | null {
  if (!row.extended_snapshot || typeof row.extended_snapshot !== "object" || Array.isArray(row.extended_snapshot)) {
    if (row.extended_format_version) {
      return {
        formatVersion: row.extended_format_version,
        sourceSha256: row.extended_source_sha256,
        isHolding: row.is_holding,
        holdingCardLabel: row.is_holding === true ? "Карточка холдинга" : row.is_holding === false ? "Не холдинг" : null,
        managers: {
          regionalManager: toManagerRefDto({ guid: null, name: "", state: "unassigned" }),
          hardwareManager: toManagerRefDto({ guid: null, name: "", state: "unassigned" }),
          headOfSales: toManagerRefDto({ guid: null, name: "", state: "unassigned" }),
        },
        retailOutlets: [],
        dataQualityLabel: "Расширенные данные недоступны",
        sensitiveFieldsWithheld: true,
        outletNormalizedReady: false,
      };
    }
    return null;
  }

  const snapshot = row.extended_snapshot as {
    regionalManager?: ParsedManagerRef;
    hardwareManager?: ParsedManagerRef;
    headOfSales?: ParsedManagerRef;
    retailOutlets?: ParsedRetailOutlet[];
    sourceSha256?: string;
    blocks?: { outletNormalizedReady?: false };
  };

  const outlets = Array.isArray(snapshot.retailOutlets)
    ? snapshot.retailOutlets.map(toOutletDto)
    : [];

  const regionalManager = snapshot.regionalManager ?? { guid: null, name: "", state: "unassigned" as const };
  const hardwareManager = snapshot.hardwareManager ?? { guid: null, name: "", state: "unassigned" as const };
  const headOfSales = snapshot.headOfSales ?? { guid: null, name: "", state: "unassigned" as const };

  return {
    formatVersion: row.extended_format_version ?? "extended_v1",
    sourceSha256: row.extended_source_sha256 ?? snapshot.sourceSha256 ?? null,
    isHolding: row.is_holding,
    holdingCardLabel:
      row.is_holding === true ? "Карточка холдинга" : row.is_holding === false ? "Не холдинг" : null,
    managers: {
      regionalManager: toManagerRefDto(regionalManager),
      hardwareManager: toManagerRefDto(hardwareManager),
      headOfSales: toManagerRefDto(headOfSales),
    },
    retailOutlets: outlets,
    dataQualityLabel: outlets.length > 0 ? "Частично подключено" : "Структура торговых точек не передана",
    sensitiveFieldsWithheld: true,
    outletNormalizedReady: false,
  };
}
