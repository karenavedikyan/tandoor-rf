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

const GUARDED_TABLE_SPECS: { table: string; columns: Record<string, string> }[] = [
  {
    table: "onec_v3_legal_sales_lines",
    columns: {
      legal_guid: "uuid",
      sale_month: "date",
      product_type: "text",
      quantity: "numeric",
      income: "numeric",
      source_sha256: "bpchar",
    },
  },
  {
    table: "onec_v3_legal_sale_item_lines",
    columns: {
      source_sha256: "bpchar",
      source_row_index: "int4",
      legal_guid: "uuid",
      sale_month: "date",
      quantity: "numeric",
      income: "numeric",
      cost_price: "numeric",
      catalog_matched: "bool",
    },
  },
  {
    table: "onec_v3_legal_return_lines",
    columns: {
      source_sha256: "bpchar",
      source_row_index: "int4",
      legal_guid: "uuid",
      sale_month: "date",
      quantity: "numeric",
      income: "numeric",
      catalog_matched: "bool",
    },
  },
  {
    table: "onec_v3_legal_return_item_lines",
    columns: {
      source_sha256: "bpchar",
      source_row_index: "int4",
      legal_guid: "uuid",
      sale_month: "date",
      quantity: "numeric",
      income: "numeric",
      catalog_matched: "bool",
    },
  },
  {
    table: "onec_v3_legal_sales_import_month_stats",
    columns: {
      dataset: "text",
      sale_month: "date",
      source_sha256: "bpchar",
      full_row_count: "int4",
      matched_row_count: "int4",
      excluded_row_count: "int4",
    },
  },
];

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

async function tableColumnTypesMatch(
  client: PoolClient,
  table: string,
  expected: Record<string, string>,
): Promise<boolean> {
  const result = await client.query<{ column_name: string; udt_name: string }>(
    `
      SELECT column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [table],
  );
  const types = new Map(result.rows.map((r) => [r.column_name, r.udt_name]));
  return Object.entries(expected).every(([column, type]) => types.get(column) === type);
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

  const nameChecks = [
    { table: "onec_v3_legal_sales_import_quarantine_rows", columns: QUARANTINE_COLUMNS },
    { table: "onec_v3_legal_sales_bundle_apply_runs", columns: APPLY_RUN_COLUMNS },
  ];
  for (const check of nameChecks) {
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

  for (const spec of GUARDED_TABLE_SPECS) {
    const ok = await tableColumnTypesMatch(client, spec.table, spec.columns);
    if (!ok) {
      return {
        ok: false,
        code: "SCHEMA_NOT_READY",
        message: `Table ${spec.table} column types are not ready.`,
        missing: [...missing],
      };
    }
  }

  return { ok: true, appliedMigrations: [...REQUIRED_MATCHED_ONLY_MIGRATIONS] };
}
