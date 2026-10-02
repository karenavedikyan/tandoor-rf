import type { AccessContext } from "../access/types";
import type {
  ExtendedFreshnessState,
  ExtendedSnapshot,
  ManagerAssignmentState,
  ParsedManagerRef,
  ParsedRetailOutlet,
  RetailOutletHistoryEntry,
} from "../onec-clients/extended-types";
import { readExtendedSnapshot } from "../onec-clients/extended-apply";
import { canReadNestedRetailOutlets, MAX_OUTLETS_IN_DETAIL_RESPONSE } from "./outlet-access";
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
  scheduleState: "not_provided" | "partial" | "all_false" | "has_selected";
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
};

export type ClientExtendedManagersDto = {
  regionalManager: ManagerRefDto;
  hardwareManager: ManagerRefDto;
  headOfSales: ManagerRefDto;
};

export type ClientExtendedDto = {
  formatVersion: string;
  sourceSha256: string | null;
  importedAt: string | null;
  importedAtLabel: string | null;
  freshnessState: ExtendedFreshnessState | null;
  freshnessLabel: string;
  isHolding: boolean | null;
  holdingCardLabel: string | null;
  managers: ClientExtendedManagersDto;
  retailOutlets: RetailOutletDto[];
  retailOutletsTruncated: boolean;
  retailOutletsAccess: "granted" | "denied";
  retailOutletHistoryCount: number;
  dataQualityLabel: string;
  sensitiveFieldsWithheld: true;
  outletNormalizedReady: false;
  clientExtendedReady: boolean;
};

type LoadingDayField = Exclude<keyof ParsedRetailOutlet["loading"], "loadingTime">;
function formatMskDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

const DAY_LABELS: Array<[LoadingDayField, string, string]> = [
  ["loadingOnMonday", "mon", "Пн"],
  ["loadingOnTuesday", "tue", "Вт"],
  ["loadingOnWednesday", "wed", "Ср"],
  ["loadingOnThursday", "thu", "Чт"],
  ["loadingOnFriday", "fri", "Пт"],
  ["loadingOnSaturday", "sat", "Сб"],
  ["loadingOnSunday", "sun", "Вс"],
];

function freshnessLabel(state: ExtendedFreshnessState | null): string {
  if (state === "current") {
    return "Обновлено из текущей выгрузки";
  }
  if (state === "preserved_from_previous") {
    return "Сохранено из предыдущей выгрузки (блок не передан в текущем снимке)";
  }
  if (state === "not_provided_in_snapshot") {
    return "Расширенный блок не передан";
  }
  return "Актуальность расширенных данных неизвестна";
}

function managerAssignmentLabel(ref: ParsedManagerRef): string {
  if (ref.state === "unassigned") {
    return "Не назначен";
  }
  if (ref.state === "invalid") {
    return "Некорректный идентификатор";
  }
  if (ref.state === "directory_unverified") {
    return ref.name.trim().length > 0
      ? `${ref.name.trim()} · Справочник 1С не проверен`
      : "Справочник 1С не проверен";
  }
  if (ref.state === "directory_unverified_account_linked") {
    return ref.name.trim().length > 0
      ? `${ref.name.trim()} · Связь с аккаунтом ЛК (справочник 1С не проверен)`
      : "Связь с аккаунтом ЛК (справочник 1С не проверен)";
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

function resolveLoadingScheduleState(outlet: ParsedRetailOutlet): RetailOutletLoadingDto["scheduleState"] {
  const dayValues = DAY_LABELS.map(([field]) => outlet.loading[field]);
  const hasAnyDayKey = dayValues.some((value) => value !== null);
  const hasSelected = dayValues.some((value) => value === true);
  if (!hasAnyDayKey && !outlet.loading.loadingTime) {
    return "not_provided";
  }
  if (hasAnyDayKey && !hasSelected) {
    return "all_false";
  }
  if (hasAnyDayKey && hasSelected && dayValues.some((value) => value === null)) {
    return "partial";
  }
  if (hasSelected) {
    return "has_selected";
  }
  return "partial";
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
    scheduleState: resolveLoadingScheduleState(outlet),
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
  };
}

function readCurrentOutlets(snapshot: ExtendedSnapshot | null): ParsedRetailOutlet[] {
  if (!snapshot) {
    return [];
  }
  if (Array.isArray(snapshot.currentRetailOutlets)) {
    return snapshot.currentRetailOutlets;
  }
  const legacy = (snapshot as { retailOutlets?: ParsedRetailOutlet[] }).retailOutlets;
  return Array.isArray(legacy) ? legacy : [];
}

function readHistoryCount(snapshot: ExtendedSnapshot | null): number {
  if (!snapshot || !Array.isArray(snapshot.retailOutletHistory)) {
    return 0;
  }
  return snapshot.retailOutletHistory.length;
}

type ExtendedRow = {
  is_holding: boolean | null;
  extended_format_version: string | null;
  extended_source_sha256: string | null;
  extended_imported_at: Date | null;
  extended_freshness_state: ExtendedFreshnessState | null;
  extended_snapshot: unknown;
};

export function toClientExtendedDto(
  row: ExtendedRow,
  context?: AccessContext,
): ClientExtendedDto | null {
  const outletAccessGranted = context ? canReadNestedRetailOutlets(context) : false;

  if (!row.extended_snapshot || typeof row.extended_snapshot !== "object" || Array.isArray(row.extended_snapshot)) {
    if (row.extended_format_version) {
      return {
        formatVersion: row.extended_format_version,
        sourceSha256: row.extended_source_sha256,
        importedAt: row.extended_imported_at?.toISOString() ?? null,
        importedAtLabel: row.extended_imported_at ? formatMskDateTime(row.extended_imported_at) : null,
        freshnessState: row.extended_freshness_state,
        freshnessLabel: freshnessLabel(row.extended_freshness_state),
        isHolding: row.is_holding,
        holdingCardLabel:
          row.is_holding === true ? "Карточка холдинга" : row.is_holding === false ? "Не холдинг" : null,
        managers: {
          regionalManager: toManagerRefDto({ guid: null, name: "", state: "unassigned" }),
          hardwareManager: toManagerRefDto({ guid: null, name: "", state: "unassigned" }),
          headOfSales: toManagerRefDto({ guid: null, name: "", state: "unassigned" }),
        },
        retailOutlets: [],
        retailOutletsTruncated: false,
        retailOutletsAccess: outletAccessGranted ? "granted" : "denied",
        retailOutletHistoryCount: 0,
        dataQualityLabel: "Расширенные данные недоступны",
        sensitiveFieldsWithheld: true,
        outletNormalizedReady: false,
        clientExtendedReady: false,
      };
    }
    return null;
  }

  const snapshot = readExtendedSnapshot(row.extended_snapshot);
  const currentOutlets = readCurrentOutlets(snapshot);
  const historyCount = readHistoryCount(snapshot);

  const regionalManager = snapshot?.regionalManager ?? { guid: null, name: "", state: "unassigned" as const };
  const hardwareManager = snapshot?.hardwareManager ?? { guid: null, name: "", state: "unassigned" as const };
  const headOfSales = snapshot?.headOfSales ?? { guid: null, name: "", state: "unassigned" as const };

  const visibleOutlets = outletAccessGranted
    ? currentOutlets.slice(0, MAX_OUTLETS_IN_DETAIL_RESPONSE)
    : [];
  const truncated = outletAccessGranted && currentOutlets.length > MAX_OUTLETS_IN_DETAIL_RESPONSE;

  const clientExtendedReady = snapshot?.blocks?.clientExtendedReady === true;

  let dataQualityLabel = "Структура торговых точек не передана";
  if (!outletAccessGranted) {
    dataQualityLabel = "Торговые точки недоступны для вашей роли";
  } else if (row.extended_freshness_state === "preserved_from_previous") {
    dataQualityLabel = "Расширенные данные сохранены из предыдущей выгрузки";
  } else if (currentOutlets.length > 0) {
    dataQualityLabel = "Частично подключено";
  }

  return {
    formatVersion: row.extended_format_version ?? snapshot?.formatVersion ?? "extended_v1",
    sourceSha256: row.extended_source_sha256 ?? snapshot?.sourceSha256 ?? null,
    importedAt: row.extended_imported_at?.toISOString() ?? snapshot?.importedAt ?? null,
    importedAtLabel: row.extended_imported_at
      ? formatMskDateTime(row.extended_imported_at)
      : snapshot?.importedAt
        ? snapshot.importedAt
        : null,
    freshnessState: row.extended_freshness_state,
    freshnessLabel: freshnessLabel(row.extended_freshness_state),
    isHolding: row.is_holding,
    holdingCardLabel:
      row.is_holding === true ? "Карточка холдинга" : row.is_holding === false ? "Не холдинг" : null,
    managers: {
      regionalManager: toManagerRefDto(regionalManager),
      hardwareManager: toManagerRefDto(hardwareManager),
      headOfSales: toManagerRefDto(headOfSales),
    },
    retailOutlets: visibleOutlets.map(toOutletDto),
    retailOutletsTruncated: truncated,
    retailOutletsAccess: outletAccessGranted ? "granted" : "denied",
    retailOutletHistoryCount: outletAccessGranted ? historyCount : 0,
    dataQualityLabel,
    sensitiveFieldsWithheld: true,
    outletNormalizedReady: false,
    clientExtendedReady,
  };
}

export type { RetailOutletHistoryEntry };
