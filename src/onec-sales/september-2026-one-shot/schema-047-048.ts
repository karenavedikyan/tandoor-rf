import type { PoolClient } from "pg";
import { REQUIRED_MIGRATIONS_047_048 } from "./scope-pins";

export async function assertSchema047048Ready(
  client: PoolClient,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const applied = await client.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations WHERE filename = ANY($1::text[])`,
    [REQUIRED_MIGRATIONS_047_048],
  );
  const have = new Set(applied.rows.map((r) => r.filename));
  const missing = REQUIRED_MIGRATIONS_047_048.filter((f) => !have.has(f));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "SCHEMA_047_048_NOT_READY",
      message: `Missing migrations: ${missing.join(", ")}`,
    };
  }
  const tables = [
    "onec_v3_legal_sales_lines",
    "onec_v3_legal_sale_item_lines",
    "onec_v3_legal_return_lines",
    "onec_v3_legal_return_item_lines",
    "onec_v3_legal_sales_import_state",
    "onec_v3_legal_sale_item_import_state",
    "onec_v3_legal_return_import_state",
    "onec_v3_legal_return_item_import_state",
    "onec_v3_legal_sales_month_activation",
  ];
  for (const table of tables) {
    await client.query(`SELECT 1 FROM ${table} LIMIT 0`);
  }
  return { ok: true };
}
