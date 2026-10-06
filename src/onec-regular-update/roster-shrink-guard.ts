import type { PoolClient } from "pg";
import type { WholesaleEmployeeRoster } from "../onec-clients/employee-roster";
import type { ValidatedClientsPayload } from "../onec-clients/types";

export type RosterShrinkGuardResult =
  | { ok: true }
  | {
      ok: false;
      code: "ROSTER_SHRINK_AMBIGUOUS";
      message: string;
      affectedManagerGuids: string[];
    };

export async function detectAmbiguousRosterShrink(
  client: PoolClient,
  input: {
    roster: WholesaleEmployeeRoster;
    clientsPayload: ValidatedClientsPayload;
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

  const removedSet = new Set(removedGuids);
  const affectedManagerGuids = new Set<string>();
  for (const record of input.clientsPayload.records) {
    if (removedSet.has(record.guid_manager.toLowerCase())) {
      affectedManagerGuids.add(record.guid_manager.toLowerCase());
    }
  }

  if (affectedManagerGuids.size === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    code: "ROSTER_SHRINK_AMBIGUOUS",
    message:
      "Employee roster shrink is ambiguous: one or more managers absent from the roster still have clients in the incoming snapshot. Full/partial roster and dismissal rules are not agreed yet.",
    affectedManagerGuids: [...affectedManagerGuids],
  };
}
