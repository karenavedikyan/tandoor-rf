import type { AccessContext } from "../access/types";
import { telHrefFromPhone } from "./phone";
import { toClientExtendedDto, type ClientExtendedDto, type ClientExtendedDtoOptions } from "./extended-dto";
import {
  REVIEW_DECISION_LABELS,
  REVIEW_STATE_LABELS,
  type ReviewDecision,
  type ReviewState,
} from "./review/constants";
import { computeClientReviewFingerprint } from "./review/fingerprint";
import { shortUuidLabel } from "./uuid-param";

export type ClientListItemDto = {
  guid: string;
  name: string;
  holding: {
    id: string | null;
    name: string;
    linkState?: "none" | "resolved" | "unresolved";
    pendingId?: string | null;
  };
  manager: {
    id: string;
    name: string;
    shortId: string;
  };
  address: string;
  phonePreview: {
    primary: string | null;
    extraCount: number;
  };
  teamContext?: {
    label: string | null;
    unassignedReason: string | null;
  };
  outletsCount?: number;
  review?: {
    state: string;
    stateLabel: string;
    decision: string | null;
    decisionLabel: string | null;
    isStale: boolean;
    transferStatus: "none" | "proposed" | "confirmed_in_1c";
  };
};

export type ClientDetailDto = {
  guid: string;
  name: string;
  manager: {
    id: string;
    name: string;
    shortId: string;
  };
  address: string;
  phones: Array<{
    value: string;
    telHref: string | null;
  }>;
  holding: {
    id: string | null;
    name: string;
    linkState?: "none" | "resolved" | "unresolved";
    pendingId?: string | null;
  } | null;
  managerRosterState?: import("../onec-clients/extended-types").ClientManagerRosterState;
  sourceLabel: string;
  lastImportedAt: string;
  lastImportedAtLabel: string;
  extended?: ClientExtendedDto;
};

export type { ClientExtendedDto };

export type ClientOptionDto = {
  id: string;
  name: string;
  shortId: string;
};

export type ClientsListResponse = {
  items: ClientListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isEmptyDatabase: boolean;
};

export type RetailOutletListItemDto = {
  guidStore: string;
  guidClient: string;
  clientName: string;
  outletLabel: string;
  address: string;
  isClosed: boolean;
  closureStatusLabel: string;
  holdingName: string;
  manager: {
    id: string;
    name: string;
    shortId: string;
  };
};

export type RetailOutletsListResponse = {
  items: RetailOutletListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isEmptyDatabase: boolean;
};

export type ClientsOptionsResponse = {
  managers: ClientOptionDto[];
  holdings: ClientOptionDto[];
};

export type ClientsSyncFreshnessState =
  | "never"
  | "current"
  | "stale"
  | "error"
  | "updating"
  | "pending_apply"
  | "unknown";

export type ClientsSyncStatusResponse = {
  freshnessState: ClientsSyncFreshnessState;
  lastSuccessfulImportAt: string | null;
  lastSuccessfulImportAtLabel: string | null;
  lastAttemptAt: string | null;
  lastAttemptAtLabel: string | null;
  lastVerifiedAt: string | null;
  lastVerifiedAtLabel: string | null;
  /** Whether 1C source formation time is known (distinct from LK load time). */
  sourceFormationKnown: boolean;
  lastSourceModifiedAt: string | null;
  lastSourceModifiedAtLabel: string | null;
  runningImport: boolean;
  warning: string | null;
  /** Admin-only detail; omitted for scoped roles. */
  adminDetail?: {
    lastErrorCode: string | null;
    recordCount: number | null;
    committedSha256: string | null;
    verifiedSha256: string | null;
    warningCount: number | null;
    warningsTruncated: boolean | null;
    applyBlocked: boolean;
  };
};

type ClientRow = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_holding_pending?: string | null;
  holding_link_state?: import("../onec-clients/holding-link-policy").HoldingLinkState;
  manager_roster_state?: import("../onec-clients/extended-types").ClientManagerRosterState;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: unknown;
  last_imported_at: Date;
  source_sha256?: string | null;
  is_holding?: boolean | null;
  extended_format_version?: string | null;
  extended_source_sha256?: string | null;
  extended_imported_at?: Date | null;
  extended_freshness_state?: import("../onec-clients/extended-types").ExtendedFreshnessState | null;
  extended_snapshot?: unknown;
  outlets_count?: string | number | null;
  review_state?: ReviewState | null;
  review_decision?: ReviewDecision | null;
  review_stale_reason?: string | null;
  review_basis_manager_guid?: string | null;
  review_basis_data_fingerprint?: string | null;
  review_proposed_manager_guid?: string | null;
  team_label?: string | null;
  unassigned_reason?: string | null;
};

function holdingDtoFromRow(row: ClientRow): ClientListItemDto["holding"] {
  if (row.holding_link_state === "unresolved" && row.guid_holding_pending) {
    return {
      id: null,
      name: row.name_holding,
      linkState: "unresolved",
      pendingId: row.guid_holding_pending,
    };
  }
  return {
    id: row.guid_holding,
    name: row.name_holding,
    linkState: row.holding_link_state ?? (row.guid_holding ? "resolved" : "none"),
    pendingId: null,
  };
}

export function formatMskDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function parseTelephones(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function phonePreviewFromTelephones(telephones: string[]): ClientListItemDto["phonePreview"] {
  const nonEmpty = telephones.map((item) => item.trim()).filter((item) => item.length > 0);
  if (nonEmpty.length === 0) {
    return { primary: null, extraCount: 0 };
  }
  return {
    primary: nonEmpty[0] ?? null,
    extraCount: Math.max(0, nonEmpty.length - 1),
  };
}

function reviewTransferStatusFromRow(
  row: ClientRow,
): "none" | "proposed" | "confirmed_in_1c" {
  if (row.review_decision !== "propose_transfer" || !row.review_proposed_manager_guid) {
    return "none";
  }
  const proposedMatchesCurrent =
    row.guid_manager.toLowerCase() === row.review_proposed_manager_guid.toLowerCase();
  const basisDiffersFromCurrent =
    row.review_basis_manager_guid != null &&
    row.review_basis_manager_guid.toLowerCase() !== row.guid_manager.toLowerCase();
  if (proposedMatchesCurrent && basisDiffersFromCurrent && !row.review_stale_reason) {
    return "confirmed_in_1c";
  }
  return "proposed";
}

function isReviewStaleFromRow(row: ClientRow): boolean {
  if (row.review_stale_reason) {
    return true;
  }
  const confirmedTransfer =
    row.review_decision === "propose_transfer" &&
    row.review_proposed_manager_guid &&
    row.review_proposed_manager_guid.toLowerCase() === row.guid_manager.toLowerCase() &&
    row.review_basis_manager_guid != null &&
    row.review_basis_manager_guid.toLowerCase() !== row.guid_manager.toLowerCase();
  if (
    row.review_basis_manager_guid &&
    row.review_basis_manager_guid.toLowerCase() !== row.guid_manager.toLowerCase() &&
    !confirmedTransfer
  ) {
    return true;
  }
  if (row.review_basis_data_fingerprint) {
    const currentFingerprint = computeClientReviewFingerprint({
      guidManager: row.guid_manager,
      nameClient: row.name_client,
      guidHolding: row.guid_holding,
      guidHoldingPending: row.guid_holding_pending ?? null,
      address: row.address,
      nameManager: row.name_manager,
    });
    return currentFingerprint !== row.review_basis_data_fingerprint;
  }
  return false;
}

export function toClientListItem(row: ClientRow): ClientListItemDto {
  const telephones = parseTelephones(row.telephone);
  const reviewState = (row.review_state ?? "unreviewed") as ReviewState;
  const item: ClientListItemDto = {
    guid: row.guid_client,
    name: row.name_client,
    holding: holdingDtoFromRow(row),
    manager: {
      id: row.guid_manager,
      name: row.name_manager,
      shortId: shortUuidLabel(row.guid_manager),
    },
    address: row.address,
    phonePreview: phonePreviewFromTelephones(telephones),
  };

  if (row.team_label != null || row.unassigned_reason != null) {
    item.teamContext = {
      label: row.team_label ?? null,
      unassignedReason: row.unassigned_reason ?? null,
    };
  }

  if (row.outlets_count != null) {
    item.outletsCount = Number(row.outlets_count);
  }

  if (row.review_state != null || row.review_decision != null || row.review_stale_reason != null) {
    const isStale = isReviewStaleFromRow(row);
    const effectiveState = isStale ? "needs_recheck" : reviewState;
    item.review = {
      state: effectiveState,
      stateLabel: REVIEW_STATE_LABELS[effectiveState],
      decision: row.review_decision ?? null,
      decisionLabel: row.review_decision ? REVIEW_DECISION_LABELS[row.review_decision] : null,
      isStale,
      transferStatus: reviewTransferStatusFromRow(row),
    };
  }

  return item;
}

export function toClientDetail(
  row: ClientRow,
  context?: AccessContext,
  options?: ClientExtendedDtoOptions,
): ClientDetailDto {
  const telephones = parseTelephones(row.telephone);
  const nonEmptyPhones = telephones.filter((item) => item.trim().length > 0);
  const extended = toClientExtendedDto(
    {
      guid_manager: row.guid_manager,
      is_holding: row.is_holding ?? null,
      source_sha256: row.source_sha256 ?? null,
      extended_format_version: row.extended_format_version ?? null,
      extended_source_sha256: row.extended_source_sha256 ?? null,
      extended_imported_at: row.extended_imported_at ?? null,
      extended_freshness_state: row.extended_freshness_state ?? null,
      extended_snapshot: row.extended_snapshot,
      holding_link_state: row.holding_link_state ?? "none",
      guid_holding_pending: row.guid_holding_pending ?? null,
      manager_roster_state: row.manager_roster_state ?? "roster_not_loaded",
    },
    context,
    options,
  );
  const holdingList = holdingDtoFromRow(row);
  return {
    guid: row.guid_client,
    name: row.name_client,
    manager: {
      id: row.guid_manager,
      name: row.name_manager,
      shortId: shortUuidLabel(row.guid_manager),
    },
    address: row.address,
    phones: nonEmptyPhones.map((value) => ({
      value,
      telHref: telHrefFromPhone(value),
    })),
    holding:
      holdingList.linkState === "unresolved" && holdingList.pendingId
        ? {
            id: holdingList.pendingId,
            name: holdingList.name,
            linkState: "unresolved",
            pendingId: holdingList.pendingId,
          }
        : row.guid_holding
          ? {
              id: row.guid_holding,
              name: row.name_holding,
              linkState: holdingList.linkState ?? "resolved",
              pendingId: null,
            }
          : holdingList.linkState === "unresolved"
            ? {
                id: holdingList.pendingId ?? null,
                name: holdingList.name,
                linkState: "unresolved",
                pendingId: holdingList.pendingId ?? null,
              }
            : null,
    managerRosterState: row.manager_roster_state,
    sourceLabel: "Данные из 1С",
    lastImportedAt: row.last_imported_at.toISOString(),
    lastImportedAtLabel: formatMskDateTime(row.last_imported_at),
    ...(extended ? { extended } : {}),
  };
}

export function toClientOption(id: string, name: string): ClientOptionDto {
  return {
    id,
    name,
    shortId: shortUuidLabel(id),
  };
}
