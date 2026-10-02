import type { AccessContext } from "../access/types";
import type {
  ExtendedBlockFreshness,
  ExtendedFreshnessState,
  ExtendedSnapshot,
  ManagerAssignmentState,
  ParsedManagerRef,
  ParsedRetailOutlet,
  RetailOutletHistoryEntry,
} from "../onec-clients/extended-types";
import { readExtendedSnapshot, summarizeRowFreshness } from "../onec-clients/extended-apply";
import { resolveManagerAccountLinks } from "../onec-clients/manager-status";
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

export type BlockFreshnessEntryDto = {
  state: ExtendedFreshnessState;
  label: string;
};

export type ClientExtendedBlockFreshnessDto = {
  holding: BlockFreshnessEntryDto;
  regionalManager: BlockFreshnessEntryDto;
  hardwareManager: BlockFreshnessEntryDto;
  headOfSales: BlockFreshnessEntryDto;
  retailOutlets: BlockFreshnessEntryDto;
};

export type ClientExtendedDto = {
  formatVersion: string;
  sourceSha256: string | null;
  importedAt: string | null;
  importedAtLabel: string | null;
  freshnessState: ExtendedFreshnessState | null;
  freshnessLabel: string;
  blockFreshness: ClientExtendedBlockFreshnessDto | null;
  isHolding: boolean | null;
  holdingCardLabel: string | null;
  managers: ClientExtendedManagersDto;
  retailOutlets: RetailOutletDto[];
  retailOutletsTotalCount: number;
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

function blockFreshnessEntryLabel(state: ExtendedFreshnessState): string {
  if (state === "current") {
    return "Из текущей выгрузки";
  }
  if (state === "preserved_from_previous") {
    return "Сохранено из предыдущей выгрузки";
  }
  return "Не передано в текущем снимке";
}

function toBlockFreshnessDto(
  blockFreshness: ExtendedBlockFreshness | undefined,
): ClientExtendedBlockFreshnessDto | null {
  if (!blockFreshness) {
    return null;
  }
  return {
    holding: { state: blockFreshness.holding, label: blockFreshnessEntryLabel(blockFreshness.holding) },
    regionalManager: {
      state: blockFreshness.regionalManager,
      label: blockFreshnessEntryLabel(blockFreshness.regionalManager),
    },
    hardwareManager: {
      state: blockFreshness.hardwareManager,
      label: blockFreshnessEntryLabel(blockFreshness.hardwareManager),
    },
    headOfSales: {
      state: blockFreshness.headOfSales,
      label: blockFreshnessEntryLabel(blockFreshness.headOfSales),
    },
    retailOutlets: {
      state: blockFreshness.retailOutlets,
      label: blockFreshnessEntryLabel(blockFreshness.retailOutlets),
    },
  };
}

function freshnessLabel(
  state: ExtendedFreshnessState | null,
  blockFreshness?: ExtendedBlockFreshness | null,
): string {
  if (blockFreshness) {
    const values = Object.values(blockFreshness);
    const hasCurrent = values.some((value) => value === "current");
    const hasPreserved = values.some((value) => value === "preserved_from_previous");
    if (hasCurrent && hasPreserved) {
      return "Частично обновлено: часть блоков сохранена из предыдущей выгрузки";
    }
  }
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
  if (ref.state === "not_provided") {
    return "Не передано";
  }
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
  const hasAnyProvided = dayValues.some((value) => value !== null);
  const hasSelected = dayValues.some((value) => value === true);
  const hasNull = dayValues.some((value) => value === null);

  if (!hasAnyProvided && !outlet.loading.loadingTime) {
    return "not_provided";
  }
  if (hasSelected) {
    return hasNull ? "partial" : "has_selected";
  }
  if (hasAnyProvided && hasNull) {
    return "partial";
  }
  if (hasAnyProvided && !hasSelected) {
    return "all_false";
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

function resolveSnapshotManagerLinks(
  snapshot: ExtendedSnapshot,
  linkedEmployeeGuids: ReadonlySet<string>,
): ExtendedSnapshot {
  const clientManagers = resolveManagerAccountLinks(
    [snapshot.regionalManager, snapshot.hardwareManager, snapshot.headOfSales],
    linkedEmployeeGuids,
  );
  return {
    ...snapshot,
    regionalManager: clientManagers[0]!,
    hardwareManager: clientManagers[1]!,
    headOfSales: clientManagers[2]!,
    currentRetailOutlets: snapshot.currentRetailOutlets.map((outlet) => {
      const resolved = resolveManagerAccountLinks(
        [
          outlet.managers.manager,
          outlet.managers.regionalManager,
          outlet.managers.hardwareManager,
          outlet.managers.headOfSales,
        ],
        linkedEmployeeGuids,
      );
      return {
        ...outlet,
        managers: {
          manager: resolved[0]!,
          regionalManager: resolved[1]!,
          hardwareManager: resolved[2]!,
          headOfSales: resolved[3]!,
        },
      };
    }),
  };
}

type ExtendedRow = {
  is_holding: boolean | null;
  extended_format_version: string | null;
  extended_source_sha256: string | null;
  extended_imported_at: Date | null;
  extended_freshness_state: ExtendedFreshnessState | null;
  extended_snapshot: unknown;
};

export type ClientExtendedDtoOptions = {
  linkedEmployeeGuids?: ReadonlySet<string>;
};

export function toClientExtendedDto(
  row: ExtendedRow,
  context?: AccessContext,
  options?: ClientExtendedDtoOptions,
): ClientExtendedDto | null {
  const outletAccessGranted = context ? canReadNestedRetailOutlets(context) : false;
  const linkedEmployeeGuids = options?.linkedEmployeeGuids ?? new Set<string>();

  if (!row.extended_snapshot || typeof row.extended_snapshot !== "object" || Array.isArray(row.extended_snapshot)) {
    if (row.extended_format_version) {
      return {
        formatVersion: row.extended_format_version,
        sourceSha256: row.extended_source_sha256,
        importedAt: row.extended_imported_at?.toISOString() ?? null,
        importedAtLabel: row.extended_imported_at ? formatMskDateTime(row.extended_imported_at) : null,
        freshnessState: row.extended_freshness_state,
        freshnessLabel: freshnessLabel(row.extended_freshness_state, null),
        blockFreshness: null,
        isHolding: row.is_holding,
        holdingCardLabel:
          row.is_holding === true ? "Карточка холдинга" : row.is_holding === false ? "Не холдинг" : null,
        managers: {
          regionalManager: toManagerRefDto({ guid: null, name: "", state: "not_provided" }),
          hardwareManager: toManagerRefDto({ guid: null, name: "", state: "not_provided" }),
          headOfSales: toManagerRefDto({ guid: null, name: "", state: "not_provided" }),
        },
        retailOutlets: [],
        retailOutletsTotalCount: 0,
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

  const rawSnapshot = readExtendedSnapshot(row.extended_snapshot);
  const snapshot = rawSnapshot
    ? resolveSnapshotManagerLinks(rawSnapshot, linkedEmployeeGuids)
    : null;
  const currentOutlets = readCurrentOutlets(snapshot);
  const historyCount = readHistoryCount(snapshot);

  const regionalManager = snapshot?.regionalManager ?? { guid: null, name: "", state: "not_provided" as const };
  const hardwareManager = snapshot?.hardwareManager ?? { guid: null, name: "", state: "not_provided" as const };
  const headOfSales = snapshot?.headOfSales ?? { guid: null, name: "", state: "not_provided" as const };

  const totalOutletCount = currentOutlets.length;
  const visibleOutlets = outletAccessGranted
    ? currentOutlets.slice(0, MAX_OUTLETS_IN_DETAIL_RESPONSE)
    : [];
  const truncated = outletAccessGranted && totalOutletCount > MAX_OUTLETS_IN_DETAIL_RESPONSE;

  const clientExtendedReady = snapshot?.blocks?.clientExtendedReady === true;
  const blockFreshness = snapshot?.blocks?.blockFreshness ?? null;
  const blockFreshnessDto = toBlockFreshnessDto(blockFreshness ?? undefined);
  const resolvedFreshnessState =
    blockFreshness != null
      ? summarizeRowFreshness(blockFreshness)
      : row.extended_freshness_state;
  const resolvedSourceSha256 = snapshot?.sourceSha256 ?? row.extended_source_sha256 ?? null;
  const resolvedImportedAt =
    snapshot?.importedAt ?? row.extended_imported_at?.toISOString() ?? null;

  let dataQualityLabel = "Структура торговых точек не передана";
  if (!outletAccessGranted) {
    dataQualityLabel = "Торговые точки недоступны для вашей роли";
  } else if (resolvedFreshnessState === "preserved_from_previous") {
    dataQualityLabel = "Расширенные данные сохранены из предыдущей выгрузки";
  } else if (currentOutlets.length > 0) {
    dataQualityLabel = "Частично подключено";
  }

  return {
    formatVersion: row.extended_format_version ?? snapshot?.formatVersion ?? "extended_v1",
    sourceSha256: resolvedSourceSha256,
    importedAt: resolvedImportedAt,
    importedAtLabel: row.extended_imported_at
      ? formatMskDateTime(row.extended_imported_at)
      : snapshot?.importedAt
        ? snapshot.importedAt
        : null,
    freshnessState: resolvedFreshnessState,
    freshnessLabel: freshnessLabel(resolvedFreshnessState, blockFreshness),
    blockFreshness: blockFreshnessDto,
    isHolding: row.is_holding,
    holdingCardLabel:
      row.is_holding === true ? "Карточка холдинга" : row.is_holding === false ? "Не холдинг" : null,
    managers: {
      regionalManager: toManagerRefDto(regionalManager),
      hardwareManager: toManagerRefDto(hardwareManager),
      headOfSales: toManagerRefDto(headOfSales),
    },
    retailOutlets: visibleOutlets.map(toOutletDto),
    retailOutletsTotalCount: outletAccessGranted ? totalOutletCount : 0,
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
