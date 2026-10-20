import type { WholesaleEmployeeRecord } from "./employee-roster";
import { hasRosterRawKey } from "./roster-field-values";
import { isNullUuid, isValidNonZeroUuid, normalizeUuid } from "./uuid";

export const AUTHORITATIVE_FLAT_TEAM_KEYS = [
  "guid_team",
  "name_team",
  "guid_team_leader",
  "name_team_leader",
] as const;

export type AuthoritativeTeamDeclarationKind =
  | "team_array"
  | "flat_empty"
  | "flat_member"
  | "flat_undeclared"
  | "invalid_team_array";

export type AuthoritativeFlatTeamValidationCode =
  | "FLAT_TEAM_FIELD_INVALID_TYPE"
  | "FLAT_TEAM_FIELD_INVALID_UUID"
  | "FLAT_TEAM_FIELDS_INCONSISTENT";

export type AuthoritativeFlatTeamValidationFailure = {
  ok: false;
  code: AuthoritativeFlatTeamValidationCode;
  message: string;
  details?: Record<string, unknown>;
};

export type AuthoritativeFlatTeamValidationSuccess = {
  ok: true;
  kind: "flat_empty" | "flat_member";
};

export type AuthoritativeFlatTeamValidationResult =
  | AuthoritativeFlatTeamValidationSuccess
  | AuthoritativeFlatTeamValidationFailure;

type FlatUuidFieldState = "missing_key" | "empty" | "valid" | "invalid_type" | "invalid_uuid";

function readFlatUuidFieldState(raw: Record<string, unknown>, key: string): FlatUuidFieldState {
  if (!hasRosterRawKey(raw, key)) {
    return "missing_key";
  }
  const value = raw[key];
  if (value === null || value === undefined) {
    return "empty";
  }
  if (typeof value !== "string") {
    return "invalid_type";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || isNullUuid(trimmed)) {
    return "empty";
  }
  if (!isValidNonZeroUuid(trimmed)) {
    return "invalid_uuid";
  }
  return "valid";
}

function readFlatNameFieldState(raw: Record<string, unknown>, key: string): "missing_key" | "empty" | "non_empty" | "invalid_type" {
  if (!hasRosterRawKey(raw, key)) {
    return "missing_key";
  }
  const value = raw[key];
  if (value === null || value === undefined) {
    return "empty";
  }
  if (typeof value !== "string") {
    return "invalid_type";
  }
  return value.trim().length > 0 ? "non_empty" : "empty";
}

function flatUuidValue(raw: Record<string, unknown>, key: string): string | null {
  const state = readFlatUuidFieldState(raw, key);
  if (state !== "valid") {
    return null;
  }
  const value = raw[key];
  return typeof value === "string" ? normalizeUuid(value) : null;
}

/** How authoritative full snapshot declares org membership for one employee row. */
export function classifyAuthoritativeTeamDeclaration(
  record: WholesaleEmployeeRecord,
): AuthoritativeTeamDeclarationKind {
  const raw = record.raw;
  if (hasRosterRawKey(raw, "team")) {
    if (record.teams === undefined || record.teams === null || !Array.isArray(record.teams)) {
      return "invalid_team_array";
    }
    return "team_array";
  }
  for (const key of AUTHORITATIVE_FLAT_TEAM_KEYS) {
    if (!hasRosterRawKey(raw, key)) {
      return "flat_undeclared";
    }
  }
  if (!record.guidTeam) {
    return "flat_empty";
  }
  return "flat_member";
}

export function isAuthoritativeFlatEmptyTeam(record: WholesaleEmployeeRecord): boolean {
  return classifyAuthoritativeTeamDeclaration(record) === "flat_empty";
}

/**
 * Strict flat-field validation for authoritative full snapshots.
 * Empty strings, null, and zero UUIDs count as empty; missing keys are handled separately.
 */
export function validateAuthoritativeFlatTeamRecord(
  record: WholesaleEmployeeRecord,
): AuthoritativeFlatTeamValidationResult {
  const raw = record.raw;
  const guidTeam = readFlatUuidFieldState(raw, "guid_team");
  const guidLeader = readFlatUuidFieldState(raw, "guid_team_leader");
  const nameTeam = readFlatNameFieldState(raw, "name_team");
  const nameLeader = readFlatNameFieldState(raw, "name_team_leader");

  for (const [field, state] of [
    ["guid_team", guidTeam],
    ["guid_team_leader", guidLeader],
  ] as const) {
    if (state === "invalid_type") {
      return {
        ok: false,
        code: "FLAT_TEAM_FIELD_INVALID_TYPE",
        message: `Employee ${record.guidManager} has invalid type for flat ${field} in authoritative org snapshot.`,
        details: { guidManager: record.guidManager, field },
      };
    }
    if (state === "invalid_uuid") {
      return {
        ok: false,
        code: "FLAT_TEAM_FIELD_INVALID_UUID",
        message: `Employee ${record.guidManager} has invalid UUID in flat ${field} for authoritative org snapshot.`,
        details: { guidManager: record.guidManager, field },
      };
    }
  }

  for (const [field, state] of [
    ["name_team", nameTeam],
    ["name_team_leader", nameLeader],
  ] as const) {
    if (state === "invalid_type") {
      return {
        ok: false,
        code: "FLAT_TEAM_FIELD_INVALID_TYPE",
        message: `Employee ${record.guidManager} has invalid type for flat ${field} in authoritative org snapshot.`,
        details: { guidManager: record.guidManager, field },
      };
    }
  }

  const teamEmpty = guidTeam === "empty";
  const leaderEmpty = guidLeader === "empty";
  const namesEmpty = nameTeam !== "non_empty" && nameLeader !== "non_empty";

  if (teamEmpty) {
    if (!leaderEmpty || !namesEmpty) {
      return {
        ok: false,
        code: "FLAT_TEAM_FIELDS_INCONSISTENT",
        message: `Employee ${record.guidManager} declares flat apex (empty guid_team) with non-empty team metadata.`,
        details: { guidManager: record.guidManager },
      };
    }
    return { ok: true, kind: "flat_empty" };
  }

  if (guidTeam !== "valid") {
    return {
      ok: false,
      code: "FLAT_TEAM_FIELDS_INCONSISTENT",
      message: `Employee ${record.guidManager} must declare a valid guid_team or consistently empty apex fields.`,
      details: { guidManager: record.guidManager },
    };
  }

  if (guidLeader !== "valid") {
    return {
      ok: false,
      code: "FLAT_TEAM_FIELDS_INCONSISTENT",
      message: `Employee ${record.guidManager} with guid_team must declare a valid guid_team_leader in authoritative org snapshot.`,
      details: { guidManager: record.guidManager },
    };
  }

  const teamGuid = flatUuidValue(raw, "guid_team");
  const leaderGuid = flatUuidValue(raw, "guid_team_leader");
  if (!teamGuid || !leaderGuid) {
    return {
      ok: false,
      code: "FLAT_TEAM_FIELDS_INCONSISTENT",
      message: `Employee ${record.guidManager} has incomplete flat team leader binding.`,
      details: { guidManager: record.guidManager },
    };
  }

  return { ok: true, kind: "flat_member" };
}
