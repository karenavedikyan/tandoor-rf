import { Pool } from "pg";
import { assertTestDatabaseUrl } from "../../src/shared/test-database-guard";

export type SyntheticClientInput = {
  guid_client: string;
  name_client: string;
  guid_holding?: string | null;
  name_holding?: string;
  guid_manager: string;
  name_manager: string;
  address?: string;
  telephone?: string[];
  last_imported_at?: string;
  manager_roster_state?: "roster_not_loaded" | "in_wholesale_roster" | "outside_wholesale_roster";
  baseline_status?: "active" | "archived_baseline" | "quarantined";
};

export async function insertSyntheticClients(
  databaseUrl: string,
  clients: SyntheticClientInput[],
): Promise<void> {
  assertTestDatabaseUrl(databaseUrl, "insertSyntheticClients");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  for (const client of clients) {
    await pool.query(
      `
        INSERT INTO onec_clients (
          guid_client,
          name_client,
          guid_holding,
          name_holding,
          guid_manager,
          name_manager,
          address,
          telephone,
          source_sha256,
          last_imported_at,
          manager_roster_state,
          baseline_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, COALESCE($10::timestamptz, NOW()), $11, $12)
      `,
      [
        client.guid_client,
        client.name_client,
        client.guid_holding ?? null,
        client.name_holding ?? "",
        client.guid_manager,
        client.name_manager,
        client.address ?? "",
        JSON.stringify(client.telephone ?? []),
        "0".repeat(64),
        client.last_imported_at ?? null,
        client.manager_roster_state ?? "in_wholesale_roster",
        client.baseline_status ?? "active",
      ],
    );
  }
  await pool.end();
}

export async function insertSuccessfulImportRun(
  databaseUrl: string,
  input: { finishedAt?: string; recordCount?: number } = {},
): Promise<void> {
  assertTestDatabaseUrl(databaseUrl, "insertSuccessfulImportRun");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_client_import_runs (
        status,
        mode,
        source_sha256,
        source_record_count,
        finished_at
      )
      VALUES ('success', 'apply', $1, $2, COALESCE($3::timestamptz, NOW()))
    `,
    ["a".repeat(64), input.recordCount ?? 1, input.finishedAt ?? null],
  );
  await pool.end();
}

export async function insertFailedImportRun(databaseUrl: string): Promise<void> {
  assertTestDatabaseUrl(databaseUrl, "insertFailedImportRun");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_client_import_runs (
        status,
        mode,
        source_sha256,
        finished_at,
        error_code
      )
      VALUES ('failed', 'apply', $1, NOW(), 'DATABASE_ERROR')
    `,
    ["b".repeat(64)],
  );
  await pool.end();
}

export type SyntheticRetailOutletInput = {
  guid_store: string;
  guid_client: string;
  is_closed?: boolean;
};

export async function insertSyntheticRetailOutlets(
  databaseUrl: string,
  outlets: SyntheticRetailOutletInput[],
): Promise<void> {
  assertTestDatabaseUrl(databaseUrl, "insertSyntheticRetailOutlets");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  for (const outlet of outlets) {
    await pool.query(
      `
        INSERT INTO onec_retail_outlets (
          guid_store,
          guid_client,
          is_closed,
          first_source_sha256,
          last_source_sha256
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $4)
      `,
      [
        outlet.guid_store,
        outlet.guid_client,
        outlet.is_closed ?? false,
        "0".repeat(64),
      ],
    );
  }
  await pool.end();
}

export async function updateClientExtendedSnapshot(
  databaseUrl: string,
  guidClient: string,
  extendedSnapshot: unknown,
): Promise<void> {
  assertTestDatabaseUrl(databaseUrl, "updateClientExtendedSnapshot");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      UPDATE onec_clients
      SET
        extended_snapshot = $2::jsonb,
        extended_format_version = 'extended_v1',
        extended_freshness_state = 'current'
      WHERE guid_client = $1::uuid
    `,
    [guidClient, JSON.stringify(extendedSnapshot)],
  );
  await pool.end();
}

export async function insertValidationFailedImportRun(databaseUrl: string): Promise<void> {
  assertTestDatabaseUrl(databaseUrl, "insertValidationFailedImportRun");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  await pool.query(
    `
      INSERT INTO onec_client_import_runs (
        status,
        mode,
        source_sha256,
        finished_at,
        error_code
      )
      VALUES ('validation_failed', 'apply', $1, NOW(), 'VALIDATION_FAILED')
    `,
    ["c".repeat(64)],
  );
  await pool.end();
}
