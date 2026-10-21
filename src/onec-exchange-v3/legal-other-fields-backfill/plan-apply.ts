import type { PoolClient } from "pg";
import { persistableLegalOtherFields } from "../persist-legal-other-fields";
import { stableJsonHash, type ParsedClientsOtherRow } from "./parse-clients-file";

export type LegalOtherFieldsBackfillPlanRow = {
  guidClient: string;
  previousHash: string;
  postHash: string;
  previousOtherFields: Record<string, unknown>;
  lastSourceSha256: string;
};

export type LegalOtherFieldsBackfillPlan = {
  sourceSha256: string;
  planHash: string;
  totalFileRows: number;
  knownLegalRows: number;
  unknownGuids: string[];
  duplicateGuids: string[];
  parseErrors: string[];
  unknownSourceHistoryGuids: string[];
  sourceHistoryMismatchGuids: string[];
  updateCount: number;
  unchangedCount: number;
  updates: LegalOtherFieldsBackfillPlanRow[];
};

export class LegalOtherFieldsBackfillApplyError extends Error {
  readonly code: "APPLY_PARTIAL" | "PLAN_DRIFT";
  readonly applied: number;
  readonly expected: number;

  constructor(code: "APPLY_PARTIAL" | "PLAN_DRIFT", message: string, applied: number, expected: number) {
    super(message);
    this.name = "LegalOtherFieldsBackfillApplyError";
    this.code = code;
    this.applied = applied;
    this.expected = expected;
  }
}

export function hashLegalOtherFieldsBackfillPlan(updates: LegalOtherFieldsBackfillPlanRow[]): string {
  const payload = updates
    .map((row) => `${row.guidClient}:${row.postHash}:${row.previousHash}`)
    .sort()
    .join("\n");
  return stableJsonHash(payload);
}

export function planHasBlockingPreconditions(plan: LegalOtherFieldsBackfillPlan): boolean {
  return (
    plan.duplicateGuids.length > 0 ||
    plan.parseErrors.length > 0 ||
    plan.unknownSourceHistoryGuids.length > 0 ||
    plan.sourceHistoryMismatchGuids.length > 0
  );
}

export async function planLegalOtherFieldsBackfill(
  client: PoolClient,
  parsed: {
    sourceSha256: string;
    rows: ParsedClientsOtherRow[];
    duplicateGuids: string[];
    parseErrors: string[];
  },
  options: { expectedSourceSha256: string },
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
  const unknownSourceHistoryGuids: string[] = [];
  const sourceHistoryMismatchGuids: string[] = [];
  const updates: LegalOtherFieldsBackfillPlanRow[] = [];
  let unchangedCount = 0;
  const expectedSha = options.expectedSourceSha256.toLowerCase();
  for (const row of parsed.rows) {
    const existing = byGuid.get(row.guidClient);
    if (!existing) {
      unknownGuids.push(row.guidClient);
      continue;
    }
    const previousHash = stableJsonHash(existing.otherFields);
    const stamped = persistableLegalOtherFields(row.otherFields, parsed.sourceSha256);
    const postHash = stableJsonHash(stamped);
    if (previousHash === postHash) {
      unchangedCount += 1;
      continue;
    }
    if (!existing.lastSourceSha256) {
      unknownSourceHistoryGuids.push(row.guidClient);
      continue;
    }
    if (existing.lastSourceSha256 !== expectedSha) {
      sourceHistoryMismatchGuids.push(row.guidClient);
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
    planHash: hashLegalOtherFieldsBackfillPlan(updates),
    totalFileRows: parsed.rows.length,
    knownLegalRows: parsed.rows.length - unknownGuids.length,
    unknownGuids,
    duplicateGuids: parsed.duplicateGuids,
    parseErrors: parsed.parseErrors,
    unknownSourceHistoryGuids,
    sourceHistoryMismatchGuids,
    updateCount: updates.length,
    unchangedCount,
    updates,
  };
}

export async function applyLegalOtherFieldsBackfill(
  client: PoolClient,
  parsed: { sourceSha256: string; rows: ParsedClientsOtherRow[] },
  plan: LegalOtherFieldsBackfillPlan,
  options: { expectedSourceSha256: string },
): Promise<{ applied: number }> {
  const otherByGuid = new Map(
    parsed.rows.map((row) => [
      row.guidClient,
      persistableLegalOtherFields(row.otherFields, parsed.sourceSha256),
    ]),
  );
  const expectedSha = options.expectedSourceSha256.toLowerCase();
  let applied = 0;
  for (const update of plan.updates) {
    const nextOther = otherByGuid.get(update.guidClient);
    if (!nextOther) {
      throw new LegalOtherFieldsBackfillApplyError("PLAN_DRIFT", "Planned row missing from source file.", applied, plan.updateCount);
    }
    const result = await client.query(
      `
        UPDATE onec_v3_legal_entities
        SET other_fields = $2::jsonb
        WHERE lower(guid_client::text) = $1
          AND other_fields = $3::jsonb
          AND lower(last_source_sha256) = $4
      `,
      [
        update.guidClient,
        JSON.stringify(nextOther),
        JSON.stringify(update.previousOtherFields),
        expectedSha,
      ],
    );
    if ((result.rowCount ?? 0) !== 1) {
      throw new LegalOtherFieldsBackfillApplyError(
        "APPLY_PARTIAL",
        "Row guard failed during apply (source/history drift).",
        applied,
        plan.updateCount,
      );
    }
    applied += 1;
  }
  if (applied !== plan.updateCount) {
    throw new LegalOtherFieldsBackfillApplyError(
      "APPLY_PARTIAL",
      "Apply row count does not match plan.",
      applied,
      plan.updateCount,
    );
  }
  return { applied };
}
