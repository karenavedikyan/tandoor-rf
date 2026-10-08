import type { PoolClient } from "pg";
import { PURGE_REQUIRED_TABLES } from "./constants";

const CORE_SCHEMA_TABLES = [
  "onec_clients",
  "onec_retail_outlets",
  "onec_client_import_runs",
  "onec_import_jobs",
  "onec_exchange_state",
  "onec_wholesale_employee_roster",
  "onec_wholesale_roster_state",
] as const;

export const REQUIRED_SCHEMA_OBJECTS = [
  ...new Set([...CORE_SCHEMA_TABLES, ...PURGE_REQUIRED_TABLES]),
].map((name) => ({ kind: "table" as const, name }));

/** Columns referenced by clean reload purge, clients import, roster replace, and exchange reset. */
export const REQUIRED_SCHEMA_COLUMNS = [
  { table: "onec_retail_outlets", column: "guid_store" },
  { table: "onec_retail_outlets", column: "guid_client" },
  { table: "onec_retail_outlets", column: "is_closed" },
  { table: "onec_client_import_runs", column: "status" },
  { table: "onec_client_import_runs", column: "mode" },
  { table: "onec_client_import_runs", column: "trigger_source" },
  { table: "onec_client_import_runs", column: "parent_run_id" },
  { table: "onec_client_import_runs", column: "source_sha256" },
  { table: "onec_client_import_runs", column: "source_byte_size" },
  { table: "onec_client_import_runs", column: "source_record_count" },
  { table: "onec_client_import_runs", column: "warning_count" },
  { table: "onec_client_import_runs", column: "warnings" },
  { table: "onec_client_import_runs", column: "warnings_truncated" },
  { table: "onec_client_import_runs", column: "verification_fingerprint" },
  { table: "onec_client_import_runs", column: "finished_at" },
  { table: "onec_client_import_runs", column: "error_code" },
  { table: "onec_wholesale_employee_roster", column: "guid_manager" },
  { table: "onec_wholesale_employee_roster", column: "name_manager" },
  { table: "onec_wholesale_employee_roster", column: "guid_post" },
  { table: "onec_wholesale_employee_roster", column: "post" },
  { table: "onec_wholesale_employee_roster", column: "guid_team" },
  { table: "onec_wholesale_employee_roster", column: "name_team" },
  { table: "onec_wholesale_employee_roster", column: "condition" },
  { table: "onec_wholesale_employee_roster", column: "date_of_assumption" },
  { table: "onec_wholesale_employee_roster", column: "guid_work_schedule" },
  { table: "onec_wholesale_employee_roster", column: "work_schedule" },
  { table: "onec_wholesale_employee_roster", column: "decree" },
  { table: "onec_wholesale_employee_roster", column: "email" },
  { table: "onec_wholesale_employee_roster", column: "telephone" },
  { table: "onec_wholesale_employee_roster", column: "raw_json" },
  { table: "onec_wholesale_employee_roster", column: "imported_at" },
  { table: "onec_wholesale_roster_state", column: "source_sha256" },
  { table: "onec_wholesale_roster_state", column: "employee_count" },
  { table: "onec_wholesale_roster_state", column: "imported_at" },
  { table: "onec_wholesale_team_groups", column: "guid_team" },
  { table: "onec_wholesale_team_groups", column: "guid_team_leader" },
  { table: "onec_wholesale_employee_team_memberships", column: "guid_manager" },
  { table: "onec_wholesale_employee_team_memberships", column: "guid_team" },
  { table: "onec_exchange_state", column: "last_checked_at" },
  { table: "onec_exchange_state", column: "last_checked_sha256" },
  { table: "onec_exchange_state", column: "last_successful_apply_at" },
  { table: "onec_exchange_state", column: "last_successful_apply_sha256" },
  { table: "onec_exchange_state", column: "accepted_baseline_sha256" },
  { table: "onec_exchange_state", column: "last_source_modified_at" },
  { table: "onec_exchange_state", column: "last_attempt_at" },
  { table: "onec_exchange_state", column: "last_verified_at" },
  { table: "onec_exchange_state", column: "last_verified_sha256" },
  { table: "onec_exchange_state", column: "apply_blocked" },
  { table: "onec_exchange_state", column: "apply_blocked_reason" },
  { table: "onec_exchange_state", column: "updated_at" },
] as const;

export type SchemaPreflightResult = {
  ready: boolean;
  dependencies: string[];
  missing: string[];
};

function schemaObjectKey(kind: "table" | "column", name: string, table?: string): string {
  return table ? `${kind}:${table}.${name}` : `${kind}:${name}`;
}

export async function inspectCleanReloadSchema(client: PoolClient): Promise<SchemaPreflightResult> {
  const dependencies = [
    ...REQUIRED_SCHEMA_OBJECTS.map((entry) => schemaObjectKey(entry.kind, entry.name)),
    ...REQUIRED_SCHEMA_COLUMNS.map((entry) => schemaObjectKey("column", entry.column, entry.table)),
  ];
  const missing: string[] = [];

  for (const entry of REQUIRED_SCHEMA_OBJECTS) {
    const result = await client.query<{ exists: boolean }>(
      `SELECT to_regclass($1::text) IS NOT NULL AS exists`,
      [`public.${entry.name}`],
    );
    if (result.rows[0]?.exists !== true) {
      missing.push(schemaObjectKey(entry.kind, entry.name));
    }
  }

  for (const entry of REQUIRED_SCHEMA_COLUMNS) {
    const result = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = $2
        ) AS exists
      `,
      [entry.table, entry.column],
    );
    if (result.rows[0]?.exists !== true) {
      missing.push(schemaObjectKey("column", entry.column, entry.table));
    }
  }

  return {
    ready: missing.length === 0,
    dependencies,
    missing,
  };
}

export async function assertCleanReloadSchemaReady(client: PoolClient): Promise<void> {
  const inspection = await inspectCleanReloadSchema(client);
  if (!inspection.ready) {
    throw Object.assign(
      new Error(
        `Database schema is not ready for clean reload (missing migration 032 or earlier client migrations): ${inspection.missing.join(", ")}.`,
      ),
      {
        code: "MIGRATIONS_NOT_READY",
        missing: inspection.missing,
        dependencies: inspection.dependencies,
      },
    );
  }
}
