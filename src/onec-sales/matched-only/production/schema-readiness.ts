import type { PoolClient } from "pg";
import { REQUIRED_MATCHED_ONLY_MIGRATIONS } from "./target-policy";

export type SchemaReadinessResult =
  | { ok: true; appliedMigrations: string[] }
  | { ok: false; code: "SCHEMA_NOT_READY"; message: string; missing: string[] };

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
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_import_quarantine_rows LIMIT 0`);
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_import_month_stats LIMIT 0`);
  await client.query(`SELECT 1 FROM onec_v3_legal_sales_bundle_apply_runs LIMIT 0`);
  return { ok: true, appliedMigrations: [...REQUIRED_MATCHED_ONLY_MIGRATIONS] };
}
