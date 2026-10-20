import type { WholesaleEmployeeRecord } from "./employee-roster";
import { hasRosterRawKey } from "./roster-field-values";

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
