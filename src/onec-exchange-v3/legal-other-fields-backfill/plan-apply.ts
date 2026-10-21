import type { PoolClient } from "pg";
import { stableJsonHash, type ParsedClientsOtherRow } from "./parse-clients-file";

export type LegalOtherFieldsBackfillPlanRow = {
  guidClient: string;
  previousHash: string;
  postHash: string;
  previousOtherFields: Record<string, unknown>;
  lastSourceSha256: string | null;
};

export type LegalOtherFieldsBackfillPlan = {
  sourceSha256: string;
  planHash: string;
  totalFileRows: number;
  knownLegalRows: number;
  unknownGuids: string[];
  duplicateGuids: string[];
  updateCount: number;
  unchangedCount: number;
  skippedSourceShaMismatch: number;
  updates: LegalOtherFieldsBackfillPlanRow[];
};

export function hashLegalOtherBackfillPlan(updates: LegalOtherFieldsBackfillPlanRow[]): string {
  const payload = updates
    .map((row) => `${row.guidClient}:${row.postHash}:${row.previousHash}`)
    .sort()
    .join("\n");
  return stableJsonHash(payload);
}

export async function planLegalOtherFieldsBackfill(
  client: PoolClient,
  parsed: { sourceSha256: string; rows: ParsedClientsOtherRow[]; duplicateGuids: string[] },
  options?: { requireLastSourceSha256?: string },
): Promise<LegalOtherFieldsBackfillPlan> {
  const guids = parsed.rows.map((row) => row.guidClient);
  const dbRows = await client.query<{
    guid_client: string;
    other_fields: Record<string, unknown> | null;
    last_source_sha256: string | null;
  }>(
    `
      SELECT lower(guid_client::text) AS guid_client, other_fields, lower(last_source_sha256) AS last_source_sha256
      FROM onec_v3_legal_entities
      WHERE lower(guid_client::text) = ANY($1::text[])
    `,
    [guids],
  );
  const byGuid = new Map(
    dbRows.rows.map((row) => [
      row.guid_client,
      {
        otherFields: row.other_fields ?? {},
        lastSourceSha256: row.last_source_sha256,
      },
    ]),
  );
  const unknownGuids: string[] = [];
  const updates: LegalOtherFieldsBackfillPlanRow[] = [];
  let unchangedCount = 0;
  let skippedSourceShaMismatch = 0;
  for (const row of parsed.rows) {
    const existing = byGuid.get(row.guidClient);
    if (!existing) {
      unknownGuids.push(row.guidClient);
      continue;
    }
    if (
      options?.requireLastSourceSha256 &&
      existing.lastSourceSha256 &&
      existing.lastSourceSha256 !== options.requireLastSourceSha256.toLowerCase()
    ) {
      skippedSourceShaMismatch += 1;
      continue;
    }
    const previousHash = stableJsonHash(existing.otherFields);
    const postHash = stableJsonHash(row.otherFields);
    if (previousHash === postHash) {
      unchangedCount += 1;
      continue;
    }
    updates.push({
      guidClient: row.guidClient,
      previousHash,
      postHash,
      previousOtherFields: existing.otherFields,
      lastSourceSha256: existing.lastSourceSha256,
    });
  }
  return {
    sourceSha256: parsed.sourceSha256,
    planHash: hashLegalOtherBackfillPlan(updates),
    totalFileRows: parsed.rows.length,
    knownLegalRows: parsed.rows.length - unknownGuids.length,
    unknownGuids,
    duplicateGuids: parsed.duplicateGuids,
    updateCount: updates.length,
    unchangedCount,
    skippedSourceShaMismatch,
    updates,
  };
}

export async function applyLegalOtherFieldsBackfill(
  client: PoolClient,
  parsed: { rows: ParsedClientsOtherRow[] },
  plan: LegalOtherFieldsBackfillPlan,
  options?: { requireLastSourceSha256?: string },
): Promise<{ applied: number; skippedGuard: number }> {
  const otherByGuid = new Map(parsed.rows.map((row) => [row.guidClient, row.otherFields]));
  let applied = 0;
  let skippedGuard = 0;
  for (const update of plan.updates) {
    const nextOther = otherByGuid.get(update.guidClient);
    if (!nextOther) {
      skippedGuard += 1;
      continue;
    }
    const params: unknown[] = [
      update.guidClient,
      JSON.stringify(nextOther),
      JSON.stringify(update.previousOtherFields),
    ];
    let sql = `
      UPDATE onec_v3_legal_entities
      SET other_fields = $2::jsonb
      WHERE lower(guid_client::text) = $1
        AND other_fields = $3::jsonb
    `;
    if (options?.requireLastSourceSha256) {
      params.push(options.requireLastSourceSha256.toLowerCase());
      sql += ` AND lower(COALESCE(last_source_sha256, '')) = $${params.length}`;
    }
    const result = await client.query(sql, params);
    if ((result.rowCount ?? 0) === 1) {
      applied += 1;
    } else {
      skippedGuard += 1;
    }
  }
  return { applied, skippedGuard };
}
