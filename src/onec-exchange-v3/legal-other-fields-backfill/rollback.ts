import type { PoolClient } from "pg";
import { persistableLegalOtherFields } from "../persist-legal-other-fields";
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
    expectedPostOtherFields: persistableLegalOtherFields(
      otherByGuid.get(row.guidClient) ?? {},
      plan.sourceSha256,
    ),
  }));
}

export async function persistBackfillSnapshots(
  client: PoolClient,
  plan: LegalOtherFieldsBackfillPlan,
  snapshots: BackfillSnapshotRow[],
): Promise<void> {
  for (const snap of snapshots) {
    await client.query(
      `
        INSERT INTO onec_v3_legal_other_backfill_snapshots (
          guid_client, source_sha256, plan_hash, previous_other_fields, expected_post_other_fields
        ) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb)
        ON CONFLICT (guid_client, plan_hash) DO NOTHING
      `,
      [
        snap.guidClient,
        plan.sourceSha256,
        plan.planHash,
        JSON.stringify(snap.previousOtherFields),
        JSON.stringify(snap.expectedPostOtherFields),
      ],
    );
  }
}

export async function loadBackfillSnapshots(
  client: PoolClient,
  planHash: string,
): Promise<BackfillSnapshotRow[]> {
  const result = await client.query<{
    guid_client: string;
    previous_other_fields: Record<string, unknown>;
    expected_post_other_fields: Record<string, unknown>;
    source_sha256: string;
  }>(
    `
      SELECT lower(guid_client::text) AS guid_client,
             previous_other_fields,
             expected_post_other_fields,
             lower(source_sha256) AS source_sha256
      FROM onec_v3_legal_other_backfill_snapshots
      WHERE plan_hash = $1
    `,
    [planHash],
  );
  return result.rows.map((row) => ({
    guidClient: row.guid_client,
    previousHash: "",
    postHash: "",
    previousOtherFields: row.previous_other_fields ?? {},
    lastSourceSha256: row.source_sha256,
    expectedPostOtherFields: row.expected_post_other_fields ?? {},
  }));
}

/**
 * Roll back only rows from a verified apply snapshot. Requires current other_fields to match
 * the expected post-apply payload — does not overwrite newer manual/import changes.
 */
function rollbackRowWhereClause(): string {
  return `
    lower(guid_client::text) = $1
    AND other_fields = $2::jsonb
    AND lower(coalesce(last_source_sha256, '')) = lower($3)
  `;
}

/** Read-only: rows that would pass rollback guards (no writes). */
export async function previewRollbackLegalOtherFieldsFromSnapshot(
  client: PoolClient,
  snapshots: BackfillSnapshotRow[],
): Promise<{ eligible: number; skippedGuard: number }> {
  let eligible = 0;
  let skippedGuard = 0;
  for (const snap of snapshots) {
    const result = await client.query(
      `
        SELECT 1
        FROM onec_v3_legal_entities
        WHERE ${rollbackRowWhereClause()}
        LIMIT 1
      `,
      [snap.guidClient, JSON.stringify(snap.expectedPostOtherFields), snap.lastSourceSha256],
    );
    if ((result.rowCount ?? 0) === 1) {
      eligible += 1;
    } else {
      skippedGuard += 1;
    }
  }
  return { eligible, skippedGuard };
}

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
        SET other_fields = $4::jsonb
        WHERE ${rollbackRowWhereClause()}
      `,
      [
        snap.guidClient,
        JSON.stringify(snap.expectedPostOtherFields),
        snap.lastSourceSha256,
        JSON.stringify(snap.previousOtherFields),
      ],
    );
    if ((result.rowCount ?? 0) === 1) {
      rolledBack += 1;
    } else {
      skippedGuard += 1;
    }
  }
  return { rolledBack, skippedGuard };
}
