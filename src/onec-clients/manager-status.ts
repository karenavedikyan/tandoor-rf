import { isEmptyOrValidNonZeroUuid, isValidNonZeroUuid, normalizeUuid } from "./uuid";
import type { ManagerAssignmentState, ParsedManagerRef } from "./extended-types";

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
    if (ref.state === "unassigned" || ref.state === "invalid") {
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
