import type { FieldPresenceState } from "./extended-presence";
import { isEmptyOrValidNonZeroUuid, isNullUuid, isValidNonZeroUuid, normalizeUuid } from "./uuid";
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

export function resolveManagerAccountLinks(
  refs: ParsedManagerRef[],
  linkedEmployeeGuids: ReadonlySet<string>,
): ParsedManagerRef[] {
  return refs.map((ref) => {
    if (ref.state === "not_provided" || ref.state === "unassigned" || ref.state === "invalid") {
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
