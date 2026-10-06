import type { PoolClient } from "pg";
import type { WholesaleEmployeeRoster } from "../onec-clients/employee-roster";

export type RosterShrinkGuardResult =
  | { ok: true }
  | {
      ok: false;
      code: "ROSTER_SHRINK_AMBIGUOUS";
      message: string;
      removedGuids: string[];
    };

/**
 * Until full/partial roster and dismissal rules are agreed with 1C,
 * reject any disappearance of a previously imported wholesale employee GUID.
 */
export async function detectAmbiguousRosterShrink(
  client: PoolClient,
  input: {
    roster: WholesaleEmployeeRoster;
  },
): Promise<RosterShrinkGuardResult> {
  const existing = await client.query<{ guid_manager: string }>(
    `SELECT guid_manager::text FROM onec_wholesale_employee_roster`,
  );
  const existingGuids = new Set(existing.rows.map((row) => row.guid_manager.toLowerCase()));
  if (existingGuids.size === 0) {
    return { ok: true };
  }

  const incomingGuids = input.roster.wholesaleGuids;
  const removedGuids = [...existingGuids].filter((guid) => !incomingGuids.has(guid));
  if (removedGuids.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    code: "ROSTER_SHRINK_AMBIGUOUS",
    message:
      "Employee roster shrink is ambiguous: one or more previously imported wholesale employee GUIDs are absent from the incoming roster. Full/partial roster and dismissal rules are not agreed yet.",
    removedGuids,
  };
}

/** Informational pre-lock signal for operators; not authoritative. */
export async function previewRosterShrink(
  client: PoolClient,
  roster: WholesaleEmployeeRoster,
): Promise<string[]> {
  const result = await detectAmbiguousRosterShrink(client, { roster });
  return result.ok ? [] : result.removedGuids;
}
