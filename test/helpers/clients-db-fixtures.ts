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
          last_imported_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, COALESCE($10::timestamptz, NOW()))
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
