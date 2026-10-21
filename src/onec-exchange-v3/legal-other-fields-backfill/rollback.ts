import type { PoolClient } from "pg";
import type { LegalOtherFieldsBackfillPlan, LegalOtherFieldsBackfillPlanRow } from "./plan-apply";

export type BackfillSnapshotRow = LegalOtherFieldsBackfillPlanRow & {
  expectedPostOtherFields: Record<string, unknown>;
};

export function buildBackfillSnapshotRows(
  plan: LegalOtherFieldsBackfillPlan,
  otherByGuid: Map<string, Record<string, unknown>>,
): BackfillSnapshotRow[] {
  return plan.updates.map((row) => ({
    ...row,
    expectedPostOtherFields: otherByGuid.get(row.guidClient) ?? {},
  }));
}

/**
 * Roll back only rows from a verified apply snapshot. Requires current other_fields to match
 * the expected post-apply payload — does not overwrite newer manual/import changes.
 */
export async function rollbackLegalOtherFieldsFromSnapshot(
  client: PoolClient,
  snapshots: BackfillSnapshotRow[],
): Promise<{ rolledBack: number; skippedGuard: number }> {
  let rolledBack = 0;
  let skippedGuard = 0;
  for (const snap of snapshots) {
    const result = await client.query(
      `
        UPDATE onec_v3_legal_entities
        SET other_fields = $2::jsonb
        WHERE lower(guid_client::text) = $1
          AND other_fields = $3::jsonb
      `,
      [snap.guidClient, JSON.stringify(snap.previousOtherFields), JSON.stringify(snap.expectedPostOtherFields)],
    );
    if ((result.rowCount ?? 0) === 1) {
      rolledBack += 1;
    } else {
      skippedGuard += 1;
    }
  }
  return { rolledBack, skippedGuard };
}
