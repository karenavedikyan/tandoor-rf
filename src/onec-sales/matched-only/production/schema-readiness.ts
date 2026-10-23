import type { PoolClient } from "pg";
import { REQUIRED_MATCHED_ONLY_MIGRATIONS } from "./target-policy";

export type SchemaReadinessResult =
  | { ok: true; appliedMigrations: string[] }
  | { ok: false; code: "SCHEMA_NOT_READY"; message: string; missing: string[] };

const QUARANTINE_COLUMNS = [
  "plan_hash",
  "dataset",
  "source_sha256",
  "source_row_index",
  "legal_guid",
  "sale_month",
] as const;

const APPLY_RUN_COLUMNS = [
  "plan_hash",
  "status",
  "target_db_fingerprint",
  "backup_sha256",
  "before_state_sha256",
  "after_state_sha256",
  "receipt_json",
] as const;

async function tableHasColumns(
  client: PoolClient,
  table: string,
  columns: readonly string[],
): Promise<boolean> {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [table],
  );
  const present = new Set(result.rows.map((r) => r.column_name));
  return columns.every((column) => present.has(column));
}

export async function assertMatchedOnlySchemaReady(client: PoolClient): Promise<SchemaReadinessResult> {
  const rows = await client.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations WHERE filename = ANY($1::text[])`,
    [REQUIRED_MATCHED_ONLY_MIGRATIONS],
  );
  const applied = new Set(rows.rows.map((r) => r.filename));
  const missing = REQUIRED_MATCHED_ONLY_MIGRATIONS.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "SCHEMA_NOT_READY",
      message: `Required migrations not applied: ${missing.join(", ")}`,
      missing: [...missing],
    };
  }

  const checks = [
    { table: "onec_v3_legal_sales_import_quarantine_rows", columns: QUARANTINE_COLUMNS },
    { table: "onec_v3_legal_sales_bundle_apply_runs", columns: APPLY_RUN_COLUMNS },
  ];
  for (const check of checks) {
    const ok = await tableHasColumns(client, check.table, check.columns);
    if (!ok) {
      return {
        ok: false,
        code: "SCHEMA_NOT_READY",
        message: `Table ${check.table} is missing required columns.`,
        missing: [...missing],
      };
    }
  }

  await client.query(`SELECT 1 FROM onec_v3_legal_sales_import_month_stats LIMIT 0`);
  return { ok: true, appliedMigrations: [...REQUIRED_MATCHED_ONLY_MIGRATIONS] };
}
