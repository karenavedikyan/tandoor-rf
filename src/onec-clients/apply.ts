import { Pool, type PoolClient } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { IMPORT_ADVISORY_LOCK_KEY } from "./constants";
import type { ParsedClientRecord, ValidatedClientsPayload } from "./types";

export const DB_CONNECT_TIMEOUT_MS = 5_000;

export type ApplyCounts = {
  newCount: number;
  changedCount: number;
  unchangedCount: number;
};

export type ApplyResult =
  | { ok: true; runId: string; counts: ApplyCounts; cleanupWarning?: string }
  | {
      ok: false;
      code:
        | "IMPORT_LOCKED"
        | "STALE_RUNNING_IMPORT"
        | "RECORD_COUNT_DECREASED"
        | "DATABASE_ERROR"
        | "COMMIT_UNCERTAIN";
      message: string;
      runId?: string;
    };

export type ApplyTestHooks = {
  afterRecordIndex?: number;
  failUnlock?: boolean;
  failCommit?: boolean;
};

type ExistingClientRow = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: string[];
};

function telephoneEqual(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isBusinessDataEqual(existing: ExistingClientRow, incoming: ParsedClientRecord): boolean {
  return (
    existing.name_client === incoming.name_client &&
    (existing.guid_holding ?? null) === incoming.guid_holding &&
    existing.name_holding === incoming.name_holding &&
    existing.guid_manager === incoming.guid_manager &&
    existing.name_manager === incoming.name_manager &&
    existing.address === incoming.address &&
    telephoneEqual(existing.telephone, incoming.telephone)
  );
}

async function getLastSuccessfulRecordCount(client: PoolClient): Promise<number | null> {
  const result = await client.query<{ source_record_count: number | null }>(
    `
      SELECT source_record_count
      FROM onec_client_import_runs
      WHERE status = 'success'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
  );
  return result.rows[0]?.source_record_count ?? null;
}

async function hasStaleRunningImport(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM onec_client_import_runs
      WHERE status = 'running'
    `,
  );
  return Number(result.rows[0]?.count ?? "0") > 0;
}

async function loadExistingClients(client: PoolClient): Promise<Map<string, ExistingClientRow>> {
  const result = await client.query<ExistingClientRow>(
    `
      SELECT
        guid_client::text,
        name_client,
        guid_holding::text,
        name_holding,
        guid_manager::text,
        name_manager,
        address,
        telephone
      FROM onec_clients
    `,
  );
  const map = new Map<string, ExistingClientRow>();
  for (const row of result.rows) {
    map.set(row.guid_client, {
      ...row,
      guid_holding: row.guid_holding,
      telephone: Array.isArray(row.telephone) ? row.telephone : [],
    });
  }
  return map;
}

async function insertRejectedRunJournal(
  client: PoolClient,
  payload: ValidatedClientsPayload,
  errorCode: "RECORD_COUNT_DECREASED",
): Promise<string | undefined> {
  const runInsert = await client.query<{ id: string }>(
    `
      INSERT INTO onec_client_import_runs (
        status,
        mode,
        source_sha256,
        source_byte_size,
        source_record_count,
        finished_at,
        error_code
      )
      VALUES ('failed', 'apply', $1, $2, $3, NOW(), $4)
      RETURNING id::text
    `,
    [payload.sha256, payload.byteSize, payload.recordCount, errorCode],
  );
  return runInsert.rows[0]?.id;
}

async function releaseAdvisoryLock(
  client: PoolClient,
  testHooks?: ApplyTestHooks,
): Promise<void> {
  if (testHooks?.failUnlock) {
    throw new Error("Advisory unlock failed.");
  }
  await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
}

function createImportPool(databaseUrl: string): Pool {
  const pgOptions = createPgPoolOptions(databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });
  pool.on("error", () => {
    // Connection lifecycle errors are handled per operation; avoid crashing the process.
  });
  return pool;
}

export async function applyClientsImport(options: {
  databaseUrl: string;
  payload: ValidatedClientsPayload;
  testHooks?: ApplyTestHooks;
}): Promise<ApplyResult> {
  const pool = createImportPool(options.databaseUrl);
  let client: PoolClient | undefined;
  let lockHeld = false;
  let runId: string | undefined;
  let commitConfirmed = false;
  let commitAttempted = false;
  let counts: ApplyCounts | undefined;

  try {
    client = await pool.connect();
  } catch {
    await pool.end();
    return { ok: false, code: "DATABASE_ERROR", message: "Database connection failed." };
  }

  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [IMPORT_ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      return { ok: false, code: "IMPORT_LOCKED", message: "Another clients import is already running." };
    }
    lockHeld = true;

    if (await hasStaleRunningImport(client)) {
      return {
        ok: false,
        code: "STALE_RUNNING_IMPORT",
        message: "A previous import run is still marked as running; resolve it before applying again.",
      };
    }

    const lastSuccessfulCount = await getLastSuccessfulRecordCount(client);
    if (
      lastSuccessfulCount !== null &&
      options.payload.recordCount < lastSuccessfulCount
    ) {
      runId = await insertRejectedRunJournal(client, options.payload, "RECORD_COUNT_DECREASED");
      return {
        ok: false,
        code: "RECORD_COUNT_DECREASED",
        message: "Source record count decreased compared to the last successful import.",
        runId,
      };
    }

    const runInsert = await client.query<{ id: string }>(
      `
        INSERT INTO onec_client_import_runs (
          status,
          mode,
          source_sha256,
          source_byte_size,
          source_record_count
        )
        VALUES ('running', 'apply', $1, $2, $3)
        RETURNING id::text
      `,
      [options.payload.sha256, options.payload.byteSize, options.payload.recordCount],
    );
    runId = runInsert.rows[0]?.id;

    await client.query("BEGIN");

    const existing = await loadExistingClients(client);
    let newCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;

    for (let index = 0; index < options.payload.records.length; index += 1) {
      const record = options.payload.records[index]!;
      const current = existing.get(record.guid_client);
      if (!current) {
        newCount += 1;
      } else if (isBusinessDataEqual(current, record)) {
        unchangedCount += 1;
      } else {
        changedCount += 1;
      }

      await client.query(
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
            first_imported_at,
            last_imported_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW(), NOW(), NOW()
          )
          ON CONFLICT (guid_client) DO UPDATE SET
            name_client = EXCLUDED.name_client,
            guid_holding = EXCLUDED.guid_holding,
            name_holding = EXCLUDED.name_holding,
            guid_manager = EXCLUDED.guid_manager,
            name_manager = EXCLUDED.name_manager,
            address = EXCLUDED.address,
            telephone = EXCLUDED.telephone,
            source_sha256 = EXCLUDED.source_sha256,
            last_imported_at = NOW(),
            updated_at = CASE
              WHEN onec_clients.name_client IS DISTINCT FROM EXCLUDED.name_client
                OR onec_clients.guid_holding IS DISTINCT FROM EXCLUDED.guid_holding
                OR onec_clients.name_holding IS DISTINCT FROM EXCLUDED.name_holding
                OR onec_clients.guid_manager IS DISTINCT FROM EXCLUDED.guid_manager
                OR onec_clients.name_manager IS DISTINCT FROM EXCLUDED.name_manager
                OR onec_clients.address IS DISTINCT FROM EXCLUDED.address
                OR onec_clients.telephone IS DISTINCT FROM EXCLUDED.telephone
              THEN NOW()
              ELSE onec_clients.updated_at
            END
        `,
        [
          record.guid_client,
          record.name_client,
          record.guid_holding,
          record.name_holding,
          record.guid_manager,
          record.name_manager,
          record.address,
          JSON.stringify(record.telephone),
          options.payload.sha256,
        ],
      );

      if (options.testHooks?.afterRecordIndex === index) {
        throw new Error("Simulated apply failure after record write.");
      }
    }

    await client.query(
      `
        UPDATE onec_client_import_runs
        SET
          status = 'success',
          finished_at = NOW(),
          new_count = $2,
          changed_count = $3,
          unchanged_count = $4,
          error_code = NULL
        WHERE id = $1
      `,
      [runId, newCount, changedCount, unchangedCount],
    );

    commitAttempted = true;
    if (options.testHooks?.failCommit) {
      throw new Error("Simulated commit response loss.");
    }

    await client.query("COMMIT");
    commitConfirmed = true;
    counts = { newCount, changedCount, unchangedCount };

    let cleanupWarning: string | undefined;
    try {
      await releaseAdvisoryLock(client, options.testHooks);
      lockHeld = false;
    } catch {
      cleanupWarning =
        "Import committed successfully but advisory lock release failed; verify no concurrent apply is running.";
    }

    return {
      ok: true,
      runId: runId!,
      counts: counts!,
      cleanupWarning,
    };
  } catch {
    if (commitAttempted && !commitConfirmed) {
      return {
        ok: false,
        code: "COMMIT_UNCERTAIN",
        message: "Commit outcome is unknown; inspect the import run journal by runId before retrying.",
        runId,
      };
    }

    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }

    if (runId) {
      try {
        await client.query(
          `
            UPDATE onec_client_import_runs
            SET status = 'failed', finished_at = NOW(), error_code = 'DATABASE_ERROR'
            WHERE id = $1 AND status = 'running'
          `,
          [runId],
        );
      } catch {
        // ignore journal failure
      }
    }

    return { ok: false, code: "DATABASE_ERROR", message: "Database apply failed.", runId };
  } finally {
    if (client) {
      if (lockHeld) {
        try {
          await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
        } catch {
          // ignore unlock failure during connection cleanup
        }
      }
      client.release();
    }
    await pool.end();
  }
}
