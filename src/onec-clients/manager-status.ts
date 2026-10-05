import type { FieldPresenceState } from "./extended-presence";
import { isEmptyOrValidNonZeroUuid, isNullUuid, isValidNonZeroUuid, normalizeUuid } from "./uuid";
import type { WholesaleEmployeeRoster } from "./employee-roster";
import type { ManagerAssignmentState, ParsedManagerRef } from "./extended-types";

export type ManagerFieldParseResult =
  | { ok: true; ref: ParsedManagerRef; presence: FieldPresenceState }
  | { ok: false; code: "INVALID_TYPE" | "INVALID_UUID" | "INVALID_MANAGER_PAIR" };

export function parseManagerFieldWithPresence(
  raw: Record<string, unknown>,
  guidKey: string,
  nameKey: string,
): ManagerFieldParseResult {
  const guidIn = guidKey in raw;
  const nameIn = nameKey in raw;

  if (!guidIn && !nameIn) {
    return {
      ok: true,
      presence: "missing",
      ref: { guid: null, name: "", state: "not_provided" },
    };
  }

  const guidRaw = guidIn ? raw[guidKey] : undefined;
  const nameRaw = nameIn ? raw[nameKey] : undefined;

  if (guidIn && guidRaw === null) {
    return { ok: false, code: "INVALID_TYPE" };
  }
  if (nameIn && nameRaw === null) {
    return { ok: false, code: "INVALID_TYPE" };
  }

  let name = "";
  if (nameIn) {
    if (typeof nameRaw !== "string") {
      return { ok: false, code: "INVALID_TYPE" };
    }
    name = nameRaw.trim();
  }

  if (!guidIn) {
    if (name.length > 0) {
      return { ok: false, code: "INVALID_MANAGER_PAIR" };
    }
    return {
      ok: true,
      presence: "missing",
      ref: { guid: null, name: "", state: "not_provided" },
    };
  }

  if (typeof guidRaw !== "string") {
    return { ok: false, code: "INVALID_TYPE" };
  }

  const guidTrimmed = guidRaw.trim();
  if (guidTrimmed.length === 0) {
    return {
      ok: true,
      presence: "explicit_empty",
      ref: { guid: null, name, state: "unassigned" },
    };
  }
  if (isNullUuid(guidTrimmed)) {
    if (name.length > 0) {
      return { ok: false, code: "INVALID_MANAGER_PAIR" };
    }
    return {
      ok: true,
      presence: "explicit_empty",
      ref: { guid: null, name, state: "unassigned" },
    };
  }
  if (!isValidNonZeroUuid(guidTrimmed)) {
    return { ok: false, code: "INVALID_UUID" };
  }
  return {
    ok: true,
    presence: "present",
    ref: {
      guid: normalizeUuid(guidTrimmed),
      name,
      state: "directory_unverified",
    },
  };
}

export function parseManagerRef(
  guidRaw: unknown,
  nameRaw: unknown,
  options?: { allowMissingKeys?: boolean },
): { ok: true; value: ParsedManagerRef } | { ok: false; code: "INVALID_TYPE" | "INVALID_UUID" } {
  const allowMissing = options?.allowMissingKeys === true;
  const name = typeof nameRaw === "string" ? nameRaw.trim() : typeof nameRaw === "undefined" || nameRaw === null ? "" : null;

  if (guidRaw === undefined || guidRaw === null) {
    if (!allowMissing) {
      return { ok: false, code: "INVALID_TYPE" };
    }
    if (name === null) {
      return { ok: false, code: "INVALID_TYPE" };
    }
    return {
      ok: true,
      value: { guid: null, name, state: "unassigned" },
    };
  }
  if (typeof guidRaw !== "string") {
    return { ok: false, code: "INVALID_TYPE" };
  }
  if (name === null) {
    return { ok: false, code: "INVALID_TYPE" };
  }

  const guidTrimmed = guidRaw.trim();
  if (guidTrimmed.length === 0) {
    return {
      ok: true,
      value: { guid: null, name, state: "unassigned" },
    };
  }
  if (isNullUuid(guidTrimmed)) {
    if (name.length > 0) {
      return { ok: false, code: "INVALID_UUID" };
    }
    return {
      ok: true,
      value: { guid: null, name, state: "unassigned" },
    };
  }
  if (!isValidNonZeroUuid(guidTrimmed)) {
    return { ok: false, code: "INVALID_UUID" };
  }
  return {
    ok: true,
    value: {
      guid: normalizeUuid(guidTrimmed),
      name,
      state: "directory_unverified",
    },
  };
}

export function applyWholesaleEmployeeRosterToRef(
  ref: ParsedManagerRef,
  roster: WholesaleEmployeeRoster | null | undefined,
): ParsedManagerRef {
  if (ref.state === "not_provided" || ref.state === "unassigned" || ref.state === "invalid") {
    return ref;
  }
  if (!ref.guid || !roster) {
    return ref;
  }
  if (!roster.wholesaleGuids.has(ref.guid)) {
    return { ...ref, state: "outside_wholesale_roster" };
  }
  return ref;
}

export function applyWholesaleEmployeeRosterToRefs(
  refs: ParsedManagerRef[],
  roster: WholesaleEmployeeRoster | null | undefined,
): ParsedManagerRef[] {
  return refs.map((ref) => applyWholesaleEmployeeRosterToRef(ref, roster));
}

export function resolveClientManagerRosterState(
  guidManager: string,
  roster: WholesaleEmployeeRoster | null | undefined,
): import("./extended-types").ClientManagerRosterState {
  if (!roster) {
    return "roster_not_loaded";
  }
  if (roster.isEmpty) {
    return "outside_wholesale_roster";
  }
  if (roster.wholesaleGuids.has(guidManager.toLowerCase())) {
    return "in_wholesale_roster";
  }
  return "outside_wholesale_roster";
}

export function resolveManagerAccountLinks(
  refs: ParsedManagerRef[],
  linkedEmployeeGuids: ReadonlySet<string>,
): ParsedManagerRef[] {
  return refs.map((ref) => {
    if (ref.state === "not_provided" || ref.state === "unassigned" || ref.state === "invalid") {
      return ref;
    }
    if (ref.state === "outside_wholesale_roster") {
      return ref;
    }
    if (!ref.guid) {
      return { ...ref, state: "unassigned" };
    }
    if (!isValidNonZeroUuid(ref.guid)) {
      return { ...ref, state: "invalid" };
    }
    if (linkedEmployeeGuids.has(ref.guid)) {
      return { ...ref, state: "directory_unverified_account_linked" };
    }
    return { ...ref, state: "directory_unverified" };
  });
}

export function resolveConfirmedHoldingForApply(record: {
  guid_holding: string | null;
  name_holding: string;
  holdingLinkState: import("./extended-types").HoldingLinkState;
}): { guid_holding: string | null; name_holding: string } {
  if (record.holdingLinkState === "unresolved") {
    return { guid_holding: null, name_holding: "" };
  }
  if (record.holdingLinkState === "resolved") {
    return { guid_holding: record.guid_holding, name_holding: record.name_holding };
  }
  return { guid_holding: record.guid_holding, name_holding: record.name_holding };
}

export function resolveManagerRosterStateForApply(input: {
  incomingState: import("./extended-types").ClientManagerRosterState;
  incomingManagerGuid: string;
  previousManagerRosterState: import("./extended-types").ClientManagerRosterState | null;
  previousManagerGuid: string | null;
  rosterLoadedInPayload: boolean;
}): import("./extended-types").ClientManagerRosterState {
  if (input.rosterLoadedInPayload && input.incomingState !== "roster_not_loaded") {
    return input.incomingState;
  }

  const managerChanged =
    input.previousManagerGuid != null &&
    input.previousManagerGuid.toLowerCase() !== input.incomingManagerGuid.toLowerCase();

  if (managerChanged) {
    if (input.previousManagerRosterState === "outside_wholesale_roster") {
      return "outside_wholesale_roster";
    }
    if (!input.rosterLoadedInPayload) {
      return "roster_not_loaded";
    }
    return "outside_wholesale_roster";
  }

  if (input.previousManagerRosterState === "outside_wholesale_roster") {
    return "outside_wholesale_roster";
  }

  return input.incomingState;
}

export function resolveImportLinkMetadata(
  record: import("./extended-types").ParsedExtendedClientRecord | undefined,
  options?: {
    incomingManagerGuid?: string;
    previousManagerGuid?: string | null;
    previousManagerRosterState?: import("./extended-types").ClientManagerRosterState | null;
    rosterLoadedInPayload?: boolean;
  },
): {
  holdingLinkState: import("./extended-types").HoldingLinkState;
  guidHoldingPending: string | null;
  managerRosterState: import("./extended-types").ClientManagerRosterState;
} {
  const incomingManagerGuid = options?.incomingManagerGuid ?? record?.guid_manager ?? "";
  const incomingRosterState = record?.managerRosterState ?? "roster_not_loaded";
  const managerRosterState = resolveManagerRosterStateForApply({
    incomingState: incomingRosterState,
    incomingManagerGuid,
    previousManagerRosterState: options?.previousManagerRosterState ?? null,
    previousManagerGuid: options?.previousManagerGuid ?? null,
    rosterLoadedInPayload: options?.rosterLoadedInPayload === true,
  });

  if (!record) {
    return {
      holdingLinkState: "none",
      guidHoldingPending: null,
      managerRosterState,
    };
  }
  return {
    holdingLinkState: record.holdingLinkState,
    guidHoldingPending: record.holdingLinkState === "unresolved" ? record.guid_holding : null,
    managerRosterState,
  };
}

export const MANAGER_ROSTER_SCOPE_ALLOWED_SQL = `
  COALESCE(onec_clients.manager_roster_state, 'in_wholesale_roster') <> 'outside_wholesale_roster'
`;

export function isEmptyHoldingGuid(value: string): boolean {
  return value.trim().length === 0;
}

export function parseOptionalHoldingGuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!isEmptyOrValidNonZeroUuid(trimmed)) {
    return null;
  }
  return normalizeUuid(trimmed);
}
