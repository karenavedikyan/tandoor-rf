import type { AccessContext } from "../access/types";
import type {
  ExtendedBlockFreshness,
  ExtendedBlockProvenance,
  ExtendedBlockProvenanceEntry,
  ExtendedFreshnessState,
  ExtendedSnapshot,
  ManagerAssignmentState,
  OutletProvenance,
  ParsedManagerRef,
  ParsedRetailOutlet,
  RetailOutletHistoryEntry,
} from "../onec-clients/extended-types";
import {
  readExtendedSnapshot,
  summarizeRowFreshness,
  summarizeRowFreshnessFromProvenance,
} from "../onec-clients/extended-apply";
import { resolveManagerAccountLinks } from "../onec-clients/manager-status";
import {
  canReadNestedRetailOutlets,
  countVisibleRetailOutletHistoryForContext,
  filterRetailOutletsForContext,
  MAX_OUTLETS_IN_DETAIL_RESPONSE,
} from "./outlet-access";
import { shortUuidLabel } from "./uuid-param";
import { bonusTandoorClubPresentationFromAdditional } from "./bonus-tandoor-club";
import { lprPresentationFromParsed, type LprBlockPresentation } from "./lpr-fields";
import {
  hasAnyCommercialField,
  readSnapshotCommercial,
  type ParsedClientCommercial,
} from "../onec-clients/commercial-fields";
import {
  hasAnyClientCodeExchangeField,
  readSnapshotClientCodeExchange,
} from "../onec-clients/client-code-exchange-fields";
import {
  hasAnyClientContractExchangeField,
  readSnapshotClientContractExchange,
} from "../onec-clients/client-contract-exchange-fields";
import {
  hasAnyCounterpartyExchangeField,
  readSnapshotCounterpartyExchange,
} from "../onec-clients/counterparty-exchange-fields";
import {
  hasAnyWholesaleClientExchangeField,
  readSnapshotWholesaleClientExchange,
} from "../onec-clients/wholesale-client-exchange-fields";

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
  loadingTimeNote: string | null;
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
  guidStore: string | null;
  guidStoreShortLabel: string | null;
  holdingName: string;
  identityLabel: string;
  closureStatus: "open" | "closed" | "not_provided" | "invalid";
  closureStatusLabel: string;
  closureNote: string | null;
  warehouse: boolean | null;
  warehouseLabel: string;
  addresses: RetailOutletAddressDto;
  loading: RetailOutletLoadingDto;
  managers: RetailOutletManagersDto;
  contacts: RetailOutletContactsDto;
  tandoorClub: { value: string | null; hasSource: boolean; label: string };
  bonusTandoorClub: { value: string | null; hasSource: boolean; label: string };
  lpr: LprBlockPresentation;
  distributionAllowed: false;
  distributionNote: string;
  presentInCurrentExport: boolean;
  dataSourceLabel: string;
  freshnessLabel: string;
};

export type ClientExtendedManagersDto = {
  regionalManager: ManagerRefDto;
  hardwareManager: ManagerRefDto;
  headOfSales: ManagerRefDto;
};

export type ClientCommercialFieldDto = {
  value: string | null;
  hasSource: boolean;
  label: string;
};

export type ClientCommercialDto = {
  discountProgram: ClientCommercialFieldDto;
  discountAmount: ClientCommercialFieldDto;
  markups: {
    hasSource: boolean;
    label: string;
    items: Array<{ name: string; percentageLabel: string | null }>;
  };
};

export type ClientWholesaleExchangeDto = {
  top150: ClientCommercialFieldDto;
  outletCategory: ClientCommercialFieldDto;
};

export type ClientCounterpartyDto = {
  counterparty: ClientCommercialFieldDto;
  fullName: ClientCommercialFieldDto;
  legalEntityType: ClientCommercialFieldDto;
  ogrn: ClientCommercialFieldDto;
};

export type ClientContractDto = {
  primaryContract: ClientCommercialFieldDto;
  mainAgreement: ClientCommercialFieldDto;
};

export type ClientCodeDto = {
  code1c: ClientCommercialFieldDto;
};

export type BlockFreshnessEntryDto = {
  state: ExtendedFreshnessState;
  label: string;
  sourceSha256: string | null;
  importedAt: string | null;
  importedAtLabel: string | null;
};

export type ClientExtendedBlockFreshnessDto = {
  holding: BlockFreshnessEntryDto;
  regionalManager: BlockFreshnessEntryDto;
  hardwareManager: BlockFreshnessEntryDto;
  headOfSales: BlockFreshnessEntryDto;
  retailOutlets: BlockFreshnessEntryDto;
};

export type RetailOutletsEmptyReason = "none" | "empty_snapshot" | "empty_scope";

export const RETAIL_OUTLETS_EMPTY_LABELS: Record<
  Exclude<RetailOutletsEmptyReason, "none">,
  string
> = {
  empty_snapshot: "В текущих данных 1С торговые точки не указаны",
  empty_scope: "Нет доступных торговых точек в вашей области",
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
  commercial?: ClientCommercialDto | null;
  wholesaleExchange?: ClientWholesaleExchangeDto | null;
  counterparty?: ClientCounterpartyDto | null;
  clientContract?: ClientContractDto | null;
  clientCode?: ClientCodeDto | null;
  retailOutlets: RetailOutletDto[];
  retailOutletsTotalCount: number;
  retailOutletsTruncated: boolean;
  /** Role permission to view nested outlets; independent of snapshot/scoped emptiness. */
  retailOutletsAccess: "granted" | "denied";
  /** Why granted access shows zero outlets without implying role denial. */
  retailOutletsEmptyReason: RetailOutletsEmptyReason;
  retailOutletHistoryCount: number;
  dataQualityLabel: string;
  /** @deprecated LPR is published on scoped outlets; kept for backward-compatible clients. */
  sensitiveFieldsWithheld: false;
  outletNormalizedReady: boolean;
  clientExtendedReady: boolean;
  holdingLink?: {
    state: import("../onec-clients/holding-link-policy").HoldingLinkState;
    pendingGuid: string | null;
  };
  clientManagerRosterState?: import("../onec-clients/extended-types").ClientManagerRosterState;
};

type ExtendedRow = {
  guid_manager?: string;
  is_holding: boolean | null;
  source_sha256?: string | null;
  extended_format_version: string | null;
  extended_source_sha256: string | null;
  extended_imported_at: Date | null;
  extended_freshness_state: ExtendedFreshnessState | null;
  extended_snapshot: unknown;
  holding_link_state?: import("../onec-clients/holding-link-policy").HoldingLinkState;
  guid_holding_pending?: string | null;
  manager_roster_state?: import("../onec-clients/extended-types").ClientManagerRosterState;
};

type LoadingDayField = Exclude<
  keyof ParsedRetailOutlet["loading"],
  | "loadingTime"
  | "loadingTimeSourceRaw"
  | "loadingTimeAmbiguous"
  | "loadingTimeAmbiguousIncomingRaw"
  | "loadingTimeConfirmedInCurrentExport"
  | "loadingTimeFieldProvenance"
>;

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

function commercialStringPresentation(provided: boolean, raw: string | null): ClientCommercialFieldDto {
  if (!provided) {
    return { value: null, hasSource: false, label: "Не передано" };
  }
  if (raw === null || raw.trim().length === 0) {
    return { value: null, hasSource: true, label: "Не заполнено" };
  }
  return { value: raw, hasSource: true, label: raw };
}

function commercialNumberPresentation(provided: boolean, raw: number | null): ClientCommercialFieldDto {
  if (!provided) {
    return { value: null, hasSource: false, label: "Не передано" };
  }
  if (raw === null) {
    return { value: null, hasSource: true, label: "Не заполнено" };
  }
  const label = String(raw);
  return { value: label, hasSource: true, label };
}

function markupsPresentation(commercial: ParsedClientCommercial): ClientCommercialDto["markups"] {
  if (!commercial.fieldPresence.markups) {
    return { hasSource: false, label: "Не передано", items: [] };
  }
  if (commercial.markups.length === 0) {
    return { hasSource: true, label: "Не заполнено", items: [] };
  }
  const items = commercial.markups.map((entry) => ({
    name: entry.name,
    percentageLabel: entry.percentage === null ? null : String(entry.percentage),
  }));
  const label = items
    .map((entry) => {
      const name = entry.name.length > 0 ? entry.name : "—";
      const value = entry.percentageLabel ?? "—";
      return `${name} · ${value}`;
    })
    .join("; ");
  return { hasSource: true, label, items };
}

function toClientCommercialDto(snapshot: ExtendedSnapshot | null): ClientCommercialDto | null {
  const commercial = readSnapshotCommercial(snapshot);
  if (!commercial || !hasAnyCommercialField(commercial)) {
    return null;
  }
  return {
    discountProgram: commercialStringPresentation(
      commercial.fieldPresence.discountProgram,
      commercial.discountProgram,
    ),
    discountAmount: commercialNumberPresentation(
      commercial.fieldPresence.discountAmount,
      commercial.discountAmount,
    ),
    markups: markupsPresentation(commercial),
  };
}

function toClientWholesaleExchangeDto(snapshot: ExtendedSnapshot | null): ClientWholesaleExchangeDto | null {
  const wholesale = readSnapshotWholesaleClientExchange(snapshot);
  if (!wholesale || !hasAnyWholesaleClientExchangeField(wholesale)) {
    return null;
  }
  return {
    top150: commercialStringPresentation(wholesale.fieldPresence.top150, wholesale.top150),
    outletCategory: commercialStringPresentation(
      wholesale.fieldPresence.outletCategory,
      wholesale.outletCategory,
    ),
  };
}

function toClientCounterpartyDto(snapshot: ExtendedSnapshot | null): ClientCounterpartyDto | null {
  const cp = readSnapshotCounterpartyExchange(snapshot);
  if (!cp || !hasAnyCounterpartyExchangeField(cp)) {
    return null;
  }
  return {
    counterparty: commercialStringPresentation(cp.fieldPresence.counterparty, cp.counterparty),
    fullName: commercialStringPresentation(cp.fieldPresence.fullName, cp.fullName),
    legalEntityType: commercialStringPresentation(cp.fieldPresence.legalEntityType, cp.legalEntityType),
    ogrn: commercialStringPresentation(cp.fieldPresence.ogrn, cp.ogrn),
  };
}

function toClientCodeDto(snapshot: ExtendedSnapshot | null): ClientCodeDto | null {
  const cc = readSnapshotClientCodeExchange(snapshot);
  if (!cc || !hasAnyClientCodeExchangeField(cc)) {
    return null;
  }
  return {
    code1c: commercialStringPresentation(cc.fieldPresence.code1c, cc.code1c),
  };
}

function toClientContractDto(snapshot: ExtendedSnapshot | null): ClientContractDto | null {
  const cc = readSnapshotClientContractExchange(snapshot);
  if (!cc || !hasAnyClientContractExchangeField(cc)) {
    return null;
  }
  return {
    primaryContract: commercialStringPresentation(cc.fieldPresence.primaryContract, cc.primaryContract),
    mainAgreement: commercialStringPresentation(cc.fieldPresence.mainAgreement, cc.mainAgreement),
  };
}

function formatImportedAtLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return formatMskDateTime(parsed);
}

function toBlockFreshnessEntryDto(entry: ExtendedBlockProvenanceEntry): BlockFreshnessEntryDto {
  return {
    state: entry.freshness,
    label: blockFreshnessEntryLabel(entry.freshness),
    sourceSha256: entry.sourceSha256,
    importedAt: entry.importedAt,
    importedAtLabel: formatImportedAtLabel(entry.importedAt),
  };
}

function toBlockFreshnessDtoFromProvenance(
  blockProvenance: ExtendedBlockProvenance | undefined,
): ClientExtendedBlockFreshnessDto | null {
  if (!blockProvenance) {
    return null;
  }
  return {
    holding: toBlockFreshnessEntryDto(blockProvenance.holding),
    regionalManager: toBlockFreshnessEntryDto(blockProvenance.regionalManager),
    hardwareManager: toBlockFreshnessEntryDto(blockProvenance.hardwareManager),
    headOfSales: toBlockFreshnessEntryDto(blockProvenance.headOfSales),
    retailOutlets: toBlockFreshnessEntryDto(blockProvenance.retailOutlets),
  };
}

function toBlockFreshnessEntryFromState(
  state: ExtendedFreshnessState,
  snapshot: ExtendedSnapshot,
): BlockFreshnessEntryDto {
  const provenanceEntry = snapshot.blocks?.blockProvenance
    ? Object.values(snapshot.blocks.blockProvenance).find((entry) => entry.freshness === state)
    : undefined;
  return {
    state,
    label: blockFreshnessEntryLabel(state),
    sourceSha256: provenanceEntry?.sourceSha256 ?? snapshot.sourceSha256,
    importedAt: provenanceEntry?.importedAt ?? snapshot.importedAt,
    importedAtLabel: formatImportedAtLabel(provenanceEntry?.importedAt ?? snapshot.importedAt),
  };
}

function toBlockFreshnessDtoFromFreshness(
  blockFreshness: ExtendedBlockFreshness,
  snapshot: ExtendedSnapshot,
  row: ExtendedRow,
): ClientExtendedBlockFreshnessDto {
  const applyOverride = (state: ExtendedFreshnessState): ExtendedFreshnessState => {
    if (
      row.extended_freshness_state === "preserved_from_previous" &&
      extendedNotUpdatedOnLastImport(row) &&
      state === "current"
    ) {
      return "preserved_from_previous";
    }
    return state;
  };
  return {
    holding: toBlockFreshnessEntryFromState(applyOverride(blockFreshness.holding), snapshot),
    regionalManager: toBlockFreshnessEntryFromState(applyOverride(blockFreshness.regionalManager), snapshot),
    hardwareManager: toBlockFreshnessEntryFromState(applyOverride(blockFreshness.hardwareManager), snapshot),
    headOfSales: toBlockFreshnessEntryFromState(applyOverride(blockFreshness.headOfSales), snapshot),
    retailOutlets: toBlockFreshnessEntryFromState(applyOverride(blockFreshness.retailOutlets), snapshot),
  };
}

function extendedNotUpdatedOnLastImport(row: ExtendedRow): boolean {
  return Boolean(
    row.source_sha256 &&
      row.extended_source_sha256 &&
      row.source_sha256 !== row.extended_source_sha256,
  );
}

function applyRowFreshnessOverride(
  blockProvenance: ExtendedBlockProvenance,
  row: ExtendedRow,
): ExtendedBlockProvenance {
  if (row.extended_freshness_state !== "preserved_from_previous" || !extendedNotUpdatedOnLastImport(row)) {
    return blockProvenance;
  }
  const overrideEntry = (entry: ExtendedBlockProvenanceEntry): ExtendedBlockProvenanceEntry => ({
    ...entry,
    freshness: "preserved_from_previous",
  });
  return {
    holding: overrideEntry(blockProvenance.holding),
    regionalManager: overrideEntry(blockProvenance.regionalManager),
    hardwareManager: overrideEntry(blockProvenance.hardwareManager),
    headOfSales: overrideEntry(blockProvenance.headOfSales),
    retailOutlets: overrideEntry(blockProvenance.retailOutlets),
  };
}

function resolveFreshnessState(row: ExtendedRow, snapshot: ExtendedSnapshot | null): ExtendedFreshnessState | null {
  if (row.extended_freshness_state != null) {
    return row.extended_freshness_state;
  }
  const provenance = snapshot?.blocks?.blockProvenance;
  if (provenance) {
    return summarizeRowFreshnessFromProvenance(provenance);
  }
  const blockFreshness = snapshot?.blocks?.blockFreshness;
  if (blockFreshness) {
    return summarizeRowFreshness(blockFreshness);
  }
  return null;
}

function freshnessLabel(
  state: ExtendedFreshnessState | null,
  blockProvenance?: ExtendedBlockProvenance | null,
  row?: ExtendedRow,
): string {
  if (row && extendedNotUpdatedOnLastImport(row) && row.extended_freshness_state === "preserved_from_previous") {
    return "Расширенные данные не обновлены последней выгрузкой; сохранены из предыдущего снимка";
  }
  if (blockProvenance) {
    const values = Object.values(blockProvenance).map((entry) => entry.freshness);
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
  if (ref.state === "outside_wholesale_roster") {
    return ref.name.trim().length > 0
      ? `${ref.name.trim()} · Вне оптового roster (доступ не выдаётся автоматически)`
      : "Вне оптового roster (доступ не выдаётся автоматически)";
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

function loadingTimePresentation(outlet: ParsedRetailOutlet): {
  loadingTime: string | null;
  loadingTimeNote: string | null;
} {
  const loading = outlet.loading;
  if (loading.loadingTimeAmbiguousIncomingRaw) {
    if (loading.loadingTime != null && loading.loadingTimeConfirmedInCurrentExport === false) {
      const importedAtLabel = formatImportedAtLabel(
        loading.loadingTimeFieldProvenance?.importedAt ?? null,
      );
      const base = "Сохранено из предыдущей выгрузки";
      return {
        loadingTime: loading.loadingTime,
        loadingTimeNote: importedAtLabel
          ? `${base} (${importedAtLabel}). В текущем файле передано неоднозначное значение времени приёмки.`
          : `${base}. В текущем файле передано неоднозначное значение времени приёмки.`,
      };
    }
    return {
      loadingTime: null,
      loadingTimeNote: "В текущем файле передано неоднозначное значение времени приёмки.",
    };
  }
  if (loading.loadingTimeAmbiguous && !loading.loadingTime) {
    return {
      loadingTime: null,
      loadingTimeNote: "В текущем файле передано неоднозначное значение времени приёмки.",
    };
  }
  return { loadingTime: loading.loadingTime, loadingTimeNote: null };
}

function toLoadingDto(outlet: ParsedRetailOutlet): RetailOutletLoadingDto {
  const loadingTime = loadingTimePresentation(outlet);
  return {
    days: DAY_LABELS.map(([field, key, label]) => ({
      key,
      label,
      value: outlet.loading[field],
    })),
    loadingTime: loadingTime.loadingTime,
    loadingTimeNote: loadingTime.loadingTimeNote,
    loadingEndTime: null,
    scheduleState: resolveLoadingScheduleState(outlet),
  };
}

function outletIdentityLabel(outlet: ParsedRetailOutlet): string {
  if (outlet.outletGuidStatus === "confirmed" && outlet.guidStore) {
    return `Торговая точка 1С · ${shortUuidLabel(outlet.guidStore)}`;
  }
  return "Точка из выгрузки 1С. Идентификатор ещё не передан";
}

type OutletPresentationContext = {
  retailOutletsBlockFreshness: ExtendedFreshnessState | null;
  retailOutletsBlockProvenance: ExtendedBlockProvenanceEntry | null;
  row: ExtendedRow;
};

type EffectiveOutletPresentation = {
  provenance: OutletProvenance;
  closureConfirmedInCurrentExport: boolean;
};

export type OutletDistributionGateRow = {
  extended_freshness_state: ExtendedFreshnessState | null;
  source_sha256: string | null;
  extended_source_sha256: string | null;
};

function resolveRetailOutletsBlockFreshnessForGate(
  row: OutletDistributionGateRow,
  snapshot: ExtendedSnapshot | null,
): ExtendedFreshnessState | null {
  const raw = snapshot?.blocks?.blockFreshness?.retailOutlets ?? null;
  if (raw == null) {
    return null;
  }
  if (
    row.extended_freshness_state === "preserved_from_previous" &&
    extendedNotUpdatedOnLastImport(row as ExtendedRow) &&
    raw === "current"
  ) {
    return "preserved_from_previous";
  }
  return raw;
}

export function assessOutletExportFreshness(
  outlet: ParsedRetailOutlet | null,
  row: OutletDistributionGateRow,
  snapshot: ExtendedSnapshot | null,
): { presentInCurrentExport: boolean; exportFreshness: OutletProvenance["freshness"] | null } {
  if (!outlet) {
    return { presentInCurrentExport: false, exportFreshness: null };
  }
  const context: OutletPresentationContext = {
    retailOutletsBlockFreshness: resolveRetailOutletsBlockFreshnessForGate(row, snapshot),
    retailOutletsBlockProvenance: snapshot?.blocks?.blockProvenance?.retailOutlets ?? null,
    row: row as ExtendedRow,
  };
  const effective = resolveEffectiveOutletPresentation(outlet, context);
  return {
    presentInCurrentExport: effective.provenance.freshness === "current",
    exportFreshness: effective.provenance.freshness,
  };
}

function resolveEffectiveOutletPresentation(
  outlet: ParsedRetailOutlet,
  context: OutletPresentationContext,
): EffectiveOutletPresentation {
  const blockNotCurrent =
    context.retailOutletsBlockFreshness != null && context.retailOutletsBlockFreshness !== "current";
  const extendedNotUpdated =
    context.row.extended_freshness_state === "preserved_from_previous" &&
    extendedNotUpdatedOnLastImport(context.row);

  let provenance: OutletProvenance;
  const storedProvenance = outlet.provenance;
  if (storedProvenance?.freshness) {
    if (storedProvenance.freshness === "absent_from_current_export") {
      provenance = {
        freshness: "absent_from_current_export",
        sourceSha256: storedProvenance.sourceSha256,
        importedAt: storedProvenance.importedAt,
      };
    } else if (storedProvenance.freshness === "current" && extendedNotUpdated) {
      provenance = {
        freshness: "preserved_from_previous",
        sourceSha256:
          storedProvenance.sourceSha256 ||
          context.retailOutletsBlockProvenance?.sourceSha256 ||
          "",
        importedAt:
          storedProvenance.importedAt ||
          context.retailOutletsBlockProvenance?.importedAt ||
          "",
      };
    } else {
      provenance = storedProvenance;
    }
  } else {
    provenance = {
      freshness:
        blockNotCurrent || extendedNotUpdated
          ? (context.retailOutletsBlockFreshness ?? "preserved_from_previous")
          : "current",
      sourceSha256: context.retailOutletsBlockProvenance?.sourceSha256 ?? "",
      importedAt: context.retailOutletsBlockProvenance?.importedAt ?? "",
    };
  }

  const presentInCurrentExport = provenance.freshness === "current" && !extendedNotUpdated;

  return {
    provenance,
    closureConfirmedInCurrentExport:
      presentInCurrentExport && Boolean(outlet.closureConfirmedInCurrentExport),
  };
}

function outletHasPreservedAmbiguousFields(outlet: ParsedRetailOutlet): boolean {
  return (
    (outlet.loading.loadingTime != null && outlet.loading.loadingTimeConfirmedInCurrentExport === false) ||
    (outlet.lpr.dateOfBirth != null && outlet.lpr.dateOfBirthConfirmedInCurrentExport === false)
  );
}

function outletDataSourceLabel(provenance: OutletProvenance, outlet?: ParsedRetailOutlet): string {
  if (outlet && provenance.freshness === "current" && outletHasPreservedAmbiguousFields(outlet)) {
    return "Частично подтверждено текущей выгрузкой (отдельные поля сохранены из предыдущей)";
  }
  if (provenance.freshness === "current") {
    return "Подтверждено текущей выгрузкой";
  }
  if (provenance.freshness === "absent_from_current_export") {
    return "Сохранено из предыдущей выгрузки; отсутствует в текущем файле";
  }
  if (provenance.freshness === "preserved_from_previous") {
    return "Сохранено из предыдущей выгрузки";
  }
  return "Источник не подтверждён";
}

function outletFreshnessLabel(provenance: OutletProvenance, outlet?: ParsedRetailOutlet): string {
  const importedAtLabel = formatImportedAtLabel(provenance.importedAt);
  const base = outletDataSourceLabel(provenance, outlet);
  if (importedAtLabel) {
    return `${base} (${importedAtLabel})`;
  }
  return base;
}

function outletClosurePresentation(
  outlet: ParsedRetailOutlet,
  closureConfirmedInCurrentExport: boolean,
): {
  status: RetailOutletDto["closureStatus"];
  label: string;
  note: string | null;
} {
  if (outlet.closureStatus === "open") {
    const label = closureConfirmedInCurrentExport
      ? "Открыта"
      : "Открыта (статус сохранён; не подтверждён текущей выгрузкой)";
    return { status: "open", label, note: null };
  }
  if (outlet.closureStatus === "closed") {
    const label = closureConfirmedInCurrentExport
      ? "Закрыта"
      : "Закрыта (статус сохранён; не подтверждён текущей выгрузкой)";
    return {
      status: "closed",
      label,
      note: "Точка остаётся доступной для просмотра и истории. Новые записи дистрибуции недоступны.",
    };
  }
  if (outlet.closureStatus === "invalid") {
    return { status: "invalid", label: "Статус не передан", note: null };
  }
  return { status: "not_provided", label: "Статус не передан", note: null };
}

function outletDistributionNote(outlet: ParsedRetailOutlet): string {
  if (outlet.outletGuidStatus !== "confirmed" || !outlet.guidStore) {
    return "Запись дистрибуции недоступна без подтверждённого идентификатора торговой точки.";
  }
  if (outlet.closureStatus === "closed") {
    return "Запись дистрибуции недоступна для закрытой торговой точки.";
  }
  if (outlet.closureStatus !== "open") {
    return "Запись дистрибуции недоступна без подтверждённого статуса торговой точки.";
  }
  return "Запись дистрибуции будет доступна на следующем этапе.";
}

function tandoorClubPresentation(outlet: ParsedRetailOutlet): {
  value: string | null;
  hasSource: boolean;
  label: string;
} {
  const provided = outlet.additional?.fieldPresence?.statusTandoorClub === true;
  const raw = outlet.additional?.statusTandoorClub ?? "";
  const trimmed = raw.trim();
  if (!provided) {
    return { value: null, hasSource: false, label: "Не передано" };
  }
  if (trimmed.length === 0) {
    return { value: null, hasSource: true, label: "Не заполнено" };
  }
  return { value: trimmed, hasSource: true, label: trimmed };
}

function bonusTandoorClubPresentation(outlet: ParsedRetailOutlet): {
  value: string | null;
  hasSource: boolean;
  label: string;
} {
  return bonusTandoorClubPresentationFromAdditional(outlet.additional);
}

function toOutletDto(outlet: ParsedRetailOutlet, context: OutletPresentationContext): RetailOutletDto {
  const effective = resolveEffectiveOutletPresentation(outlet, context);
  const warehouseLabel =
    outlet.warehouse === true
      ? "Используется как склад"
      : outlet.warehouse === false
        ? "Не используется как склад"
        : "Признак склада не передан";
  const closure = outletClosurePresentation(outlet, effective.closureConfirmedInCurrentExport);
  const tandoorClub = tandoorClubPresentation(outlet);
  const bonusTandoorClub = bonusTandoorClubPresentation(outlet);
  const lpr = lprPresentationFromParsed(outlet.lpr);

  return {
    ordinal: outlet.ordinal,
    guidStore: outlet.guidStore,
    guidStoreShortLabel: outlet.guidStore ? shortUuidLabel(outlet.guidStore) : null,
    holdingName: outlet.holdingName,
    identityLabel: outletIdentityLabel(outlet),
    closureStatus: closure.status,
    closureStatusLabel: closure.label,
    closureNote: closure.note,
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
    tandoorClub,
    bonusTandoorClub,
    lpr,
    distributionAllowed: false,
    distributionNote: outletDistributionNote(outlet),
    presentInCurrentExport: effective.provenance.freshness === "current",
    dataSourceLabel: outletDataSourceLabel(effective.provenance, outlet),
    freshnessLabel: outletFreshnessLabel(effective.provenance, outlet),
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

function resolveRetailOutletHistoryCount(
  context: AccessContext | undefined,
  outletAccessGranted: boolean,
  retailOutletsEmptyReason: RetailOutletsEmptyReason,
  snapshot: ExtendedSnapshot | null,
  clientManagerGuid: string,
  options?: ClientExtendedDtoOptions,
  clientHeadOfSalesGuid?: string | null,
): number {
  if (!outletAccessGranted || retailOutletsEmptyReason === "empty_scope") {
    return 0;
  }
  if (!snapshot || !Array.isArray(snapshot.retailOutletHistory) || snapshot.retailOutletHistory.length === 0) {
    return 0;
  }
  if (!context) {
    return 0;
  }
  return countVisibleRetailOutletHistoryForContext(
    context,
    clientManagerGuid,
    snapshot.retailOutletHistory,
    {
      clientHeadOfSalesGuid,
      clientHardwareManagerGuid: snapshot.hardwareManager?.guid ?? null,
      ropTeamEmployeeGuids: options?.ropTeamEmployeeGuids,
    },
  );
}

function resolveRetailOutletsEmptyReason(
  outletAccessGranted: boolean,
  scopedOutlets: ParsedRetailOutlet[],
  currentOutletsRaw: ParsedRetailOutlet[],
): RetailOutletsEmptyReason {
  if (!outletAccessGranted || scopedOutlets.length > 0) {
    return "none";
  }
  if (currentOutletsRaw.length === 0) {
    return "empty_snapshot";
  }
  return "empty_scope";
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

export type ClientExtendedDtoOptions = {
  linkedEmployeeGuids?: ReadonlySet<string>;
  ropTeamEmployeeGuids?: ReadonlySet<string>;
};

export function toClientExtendedDto(
  row: ExtendedRow,
  context?: AccessContext,
  options?: ClientExtendedDtoOptions,
): ClientExtendedDto | null {
  const outletAccessGranted = context ? canReadNestedRetailOutlets(context) : false;
  const linkedEmployeeGuids = options?.linkedEmployeeGuids ?? new Set<string>();

  const importLinkMetadata = {
    holdingLink: {
      state: row.holding_link_state ?? "none",
      pendingGuid: row.guid_holding_pending ?? null,
    },
    clientManagerRosterState: row.manager_roster_state ?? "roster_not_loaded",
  };

  if (!row.extended_snapshot || typeof row.extended_snapshot !== "object" || Array.isArray(row.extended_snapshot)) {
    if (row.extended_format_version || row.holding_link_state || row.manager_roster_state) {
      return {
        formatVersion: row.extended_format_version ?? "extended_v1",
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
        retailOutletsEmptyReason: outletAccessGranted ? "empty_snapshot" : "none",
        retailOutletHistoryCount: 0,
        dataQualityLabel:
          row.extended_format_version && !row.extended_snapshot
            ? "Расширенный блок ожидает проверки контракта"
            : "Расширенные данные недоступны",
        sensitiveFieldsWithheld: false,
        outletNormalizedReady: false,
        clientExtendedReady: false,
        ...importLinkMetadata,
      };
    }
    return null;
  }

  const rawSnapshot = readExtendedSnapshot(row.extended_snapshot);
  const snapshot = rawSnapshot
    ? resolveSnapshotManagerLinks(rawSnapshot, linkedEmployeeGuids)
    : null;
  const currentOutletsRaw = readCurrentOutlets(snapshot);
  const clientManagerGuid = row.guid_manager ?? "";
  const clientHeadOfSalesGuid = snapshot?.headOfSales?.guid ?? null;
  const clientHardwareManagerGuid = snapshot?.hardwareManager?.guid ?? null;
  const scopedOutlets = context
    ? filterRetailOutletsForContext(context, clientManagerGuid, currentOutletsRaw, {
        clientHeadOfSalesGuid,
        clientHardwareManagerGuid,
        ropTeamEmployeeGuids: options?.ropTeamEmployeeGuids,
      })
    : outletAccessGranted
      ? currentOutletsRaw
      : [];
  const retailOutletsAccess = outletAccessGranted ? "granted" : "denied";
  const retailOutletsEmptyReason = resolveRetailOutletsEmptyReason(
    outletAccessGranted,
    scopedOutlets,
    currentOutletsRaw,
  );
  const currentOutlets = outletAccessGranted ? scopedOutlets : [];
  const historyCount = resolveRetailOutletHistoryCount(
    context,
    outletAccessGranted,
    retailOutletsEmptyReason,
    snapshot,
    clientManagerGuid,
    options,
    clientHeadOfSalesGuid,
  );

  const regionalManager = snapshot?.regionalManager ?? { guid: null, name: "", state: "not_provided" as const };
  const hardwareManager = snapshot?.hardwareManager ?? { guid: null, name: "", state: "not_provided" as const };
  const headOfSales = snapshot?.headOfSales ?? { guid: null, name: "", state: "not_provided" as const };

  const totalOutletCount = currentOutlets.length;
  const visibleOutlets = outletAccessGranted
    ? currentOutlets.slice(0, MAX_OUTLETS_IN_DETAIL_RESPONSE)
    : [];
  const truncated = outletAccessGranted && totalOutletCount > MAX_OUTLETS_IN_DETAIL_RESPONSE;

  const clientExtendedReady = snapshot?.blocks?.clientExtendedReady === true;
  const outletNormalizedReady = snapshot?.blocks?.outletNormalizedReady === true;
  const rawBlockProvenance = snapshot?.blocks?.blockProvenance ?? null;
  const effectiveBlockProvenance = rawBlockProvenance
    ? applyRowFreshnessOverride(rawBlockProvenance, row)
    : null;
  const blockFreshnessDto =
    toBlockFreshnessDtoFromProvenance(effectiveBlockProvenance ?? undefined) ??
    (snapshot?.blocks?.blockFreshness
      ? toBlockFreshnessDtoFromFreshness(snapshot.blocks.blockFreshness, snapshot, row)
      : null);
  const resolvedFreshnessState = resolveFreshnessState(row, snapshot);
  const resolvedSourceSha256 =
    row.extended_source_sha256 ?? snapshot?.sourceSha256 ?? null;
  const resolvedImportedAt =
    row.extended_imported_at?.toISOString() ?? snapshot?.importedAt ?? null;

  let dataQualityLabel = "Структура торговых точек не передана";
  if (!outletAccessGranted) {
    dataQualityLabel = "Торговые точки недоступны для вашей роли";
  } else if (retailOutletsEmptyReason === "empty_snapshot") {
    dataQualityLabel = RETAIL_OUTLETS_EMPTY_LABELS.empty_snapshot;
  } else if (retailOutletsEmptyReason === "empty_scope") {
    dataQualityLabel = RETAIL_OUTLETS_EMPTY_LABELS.empty_scope;
  } else if (resolvedFreshnessState === "preserved_from_previous") {
    dataQualityLabel = "Расширенные данные сохранены из предыдущей выгрузки";
  } else if (currentOutlets.length > 0) {
    dataQualityLabel = "Частично подключено";
  }

  const retailOutletsBlockFreshness =
    effectiveBlockProvenance?.retailOutlets.freshness ??
    snapshot?.blocks?.blockFreshness?.retailOutlets ??
    null;
  const outletPresentationContext: OutletPresentationContext = {
    retailOutletsBlockFreshness,
    retailOutletsBlockProvenance: effectiveBlockProvenance?.retailOutlets ?? null,
    row,
  };

  return {
    formatVersion: row.extended_format_version ?? snapshot?.formatVersion ?? "extended_v1",
    sourceSha256: resolvedSourceSha256,
    importedAt: resolvedImportedAt,
    importedAtLabel: formatImportedAtLabel(resolvedImportedAt),
    freshnessState: resolvedFreshnessState,
    freshnessLabel: freshnessLabel(resolvedFreshnessState, effectiveBlockProvenance, row),
    blockFreshness: blockFreshnessDto,
    isHolding: row.is_holding,
    holdingCardLabel:
      row.is_holding === true ? "Карточка холдинга" : row.is_holding === false ? "Не холдинг" : null,
    managers: {
      regionalManager: toManagerRefDto(regionalManager),
      hardwareManager: toManagerRefDto(hardwareManager),
      headOfSales: toManagerRefDto(headOfSales),
    },
    commercial: toClientCommercialDto(snapshot),
    wholesaleExchange: toClientWholesaleExchangeDto(snapshot),
    counterparty: toClientCounterpartyDto(snapshot),
    clientContract: toClientContractDto(snapshot),
    clientCode: toClientCodeDto(snapshot),
    retailOutlets: visibleOutlets.map((outlet) => toOutletDto(outlet, outletPresentationContext)),
    retailOutletsTotalCount: outletAccessGranted ? totalOutletCount : 0,
    retailOutletsTruncated: truncated,
    retailOutletsAccess,
    retailOutletsEmptyReason,
    retailOutletHistoryCount: historyCount,
    dataQualityLabel,
    sensitiveFieldsWithheld: false,
    outletNormalizedReady,
    clientExtendedReady,
  };
}

export type { RetailOutletHistoryEntry };
