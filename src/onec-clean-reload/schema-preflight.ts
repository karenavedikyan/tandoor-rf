import type { PoolClient } from "pg";

export const REQUIRED_SCHEMA_OBJECTS = [
  { kind: "table" as const, name: "onec_clients" },
  { kind: "table" as const, name: "onec_retail_outlets" },
  { kind: "table" as const, name: "onec_client_import_runs" },
  { kind: "table" as const, name: "onec_import_jobs" },
  { kind: "table" as const, name: "onec_exchange_state" },
  { kind: "table" as const, name: "onec_wholesale_employee_roster" },
  { kind: "table" as const, name: "onec_wholesale_roster_state" },
] as const;

export type SchemaPreflightResult = {
  ready: boolean;
  dependencies: string[];
  missing: string[];
};

export async function inspectCleanReloadSchema(client: PoolClient): Promise<SchemaPreflightResult> {
  const dependencies = REQUIRED_SCHEMA_OBJECTS.map((entry) => `${entry.kind}:${entry.name}`);
  const missing: string[] = [];

  for (const entry of REQUIRED_SCHEMA_OBJECTS) {
    const result = await client.query<{ exists: boolean }>(
      `SELECT to_regclass($1::text) IS NOT NULL AS exists`,
      [`public.${entry.name}`],
    );
    if (result.rows[0]?.exists !== true) {
      missing.push(`${entry.kind}:${entry.name}`);
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
