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
  failRelease?: boolean;
  failPoolEnd?: boolean;
  onClientReady?: (client: PoolClient) => void;
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

class ClientConnectionFault extends Error {
  constructor() {
    super("Client connection fault.");
    this.name = "ClientConnectionFault";
  }
}

type ManagedClient = {
  client: PoolClient;
  readonly faulted: () => boolean;
  removeErrorListener: () => void;
};

type ApplyPhaseState = {
  lockHeld: boolean;
  runId?: string;
  commitAttempted: boolean;
  commitConfirmed: boolean;
  counts?: ApplyCounts;
};

const CLEANUP_LOCK_WARNING =
  "Import finished but advisory lock release failed during cleanup; verify no concurrent apply is running.";
const CLEANUP_RELEASE_WARNING =
  "Import finished but database connection release failed during cleanup.";
const CLEANUP_POOL_WARNING =
  "Import finished but database pool shutdown failed during cleanup.";

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

function mergeCleanupWarnings(existing: string | undefined, additions: string[]): string | undefined {
  const merged = [existing, ...additions].filter((value): value is string => Boolean(value));
  if (merged.length === 0) {
    return undefined;
  }
  return merged.join(" ");
}

function managePoolClient(client: PoolClient): ManagedClient {
  let faulted = false;
  const onError = () => {
    faulted = true;
  };
  client.on("error", onError);
  return {
    client,
    faulted: () => faulted,
    removeErrorListener: () => {
      client.removeListener("error", onError);
    },
  };
}

function assertClientUsable(managed: ManagedClient): void {
  if (managed.faulted()) {
    throw new ClientConnectionFault();
  }
}

async function queryManaged<T extends Record<string, unknown>>(
  managed: ManagedClient,
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  assertClientUsable(managed);
  const result = await managed.client.query<T>(text, params);
  assertClientUsable(managed);
  return result;
}

function resolveConnectionFault(state: ApplyPhaseState): ApplyResult {
  if (state.commitConfirmed && state.counts && state.runId) {
    return {
      ok: true,
      runId: state.runId,
      counts: state.counts,
      cleanupWarning:
        "Import committed successfully but the database connection failed afterward; verify the import run journal.",
    };
  }
  if (state.commitAttempted && !state.commitConfirmed) {
    return {
      ok: false,
      code: "COMMIT_UNCERTAIN",
      message: "Commit outcome is unknown; inspect the import run journal by runId before retrying.",
      runId: state.runId,
    };
  }
  return {
    ok: false,
    code: "DATABASE_ERROR",
    message: "Database connection failed during apply.",
    runId: state.runId,
  };
}

function isConnectionFault(error: unknown, managed?: ManagedClient): boolean {
  return error instanceof ClientConnectionFault || managed?.faulted() === true;
}

async function getLastSuccessfulRecordCount(managed: ManagedClient): Promise<number | null> {
  const result = await queryManaged<{ source_record_count: number | null }>(
    managed,
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

async function hasStaleRunningImport(managed: ManagedClient): Promise<boolean> {
  const result = await queryManaged<{ count: string }>(
    managed,
    `
      SELECT COUNT(*)::text AS count
      FROM onec_client_import_runs
      WHERE status = 'running'
    `,
  );
  return Number(result.rows[0]?.count ?? "0") > 0;
}

async function loadExistingClients(managed: ManagedClient): Promise<Map<string, ExistingClientRow>> {
  const result = await queryManaged<ExistingClientRow>(
    managed,
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
  managed: ManagedClient,
  payload: ValidatedClientsPayload,
  errorCode: "RECORD_COUNT_DECREASED",
): Promise<string | undefined> {
  const runInsert = await queryManaged<{ id: string }>(
    managed,
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
  managed: ManagedClient,
  testHooks?: ApplyTestHooks,
): Promise<void> {
  if (testHooks?.failUnlock) {
    throw new Error("Advisory unlock failed.");
  }
  await queryManaged(managed, "SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
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
    // Idle pool connection errors are handled per checkout; avoid crashing the process.
  });
  return pool;
}

async function safeUnlockAdvisoryLock(managed: ManagedClient | undefined, lockHeld: boolean): Promise<string | undefined> {
  if (!managed || !lockHeld || managed.faulted()) {
    return undefined;
  }
  try {
    await queryManaged(managed, "SELECT pg_advisory_unlock($1)", [IMPORT_ADVISORY_LOCK_KEY]);
    return undefined;
  } catch {
    return CLEANUP_LOCK_WARNING;
  }
}

function safeReleaseClient(
  managed: ManagedClient | undefined,
  testHooks?: ApplyTestHooks,
): string | undefined {
  if (!managed) {
    return undefined;
  }
  managed.removeErrorListener();
  try {
    if (testHooks?.failRelease) {
      throw new Error("Release failed.");
    }
    if (managed.faulted()) {
      managed.client.release(new Error("Connection fault."));
    } else {
      managed.client.release();
    }
    return undefined;
  } catch {
    try {
      managed.client.release(new Error("Cleanup release failure."));
    } catch {
      // ignore secondary release failure
    }
    return CLEANUP_RELEASE_WARNING;
  }
}

async function safeEndPool(pool: Pool | undefined, testHooks?: ApplyTestHooks): Promise<string | undefined> {
  if (!pool) {
    return undefined;
  }
  try {
    if (testHooks?.failPoolEnd) {
      throw new Error("Pool shutdown failed.");
    }
    await pool.end();
    return undefined;
  } catch {
    return CLEANUP_POOL_WARNING;
  }
}

function appendCleanupWarnings(result: ApplyResult, cleanupWarnings: string[]): ApplyResult {
  if (!result.ok || cleanupWarnings.length === 0) {
    return result;
  }
  return {
    ...result,
    cleanupWarning: mergeCleanupWarnings(result.cleanupWarning, cleanupWarnings),
  };
}

export async function applyClientsImport(options: {
  databaseUrl: string;
  payload: ValidatedClientsPayload;
  testHooks?: ApplyTestHooks;
}): Promise<ApplyResult> {
  let pool: Pool | undefined;
  let managed: ManagedClient | undefined;
  const phase: ApplyPhaseState = {
    lockHeld: false,
    commitAttempted: false,
    commitConfirmed: false,
  };
  let outcome: ApplyResult | undefined;
  const cleanupWarnings: string[] = [];

  try {
    pool = createImportPool(options.databaseUrl);
  } catch {
    return { ok: false, code: "DATABASE_ERROR", message: "Database configuration failed." };
  }

  try {
    const connected = await pool.connect();
    managed = managePoolClient(connected);
    options.testHooks?.onClientReady?.(managed.client);
  } catch {
    const poolWarning = await safeEndPool(pool, options.testHooks);
    if (poolWarning) {
      cleanupWarnings.push(poolWarning);
    }
    return { ok: false, code: "DATABASE_ERROR", message: "Database connection failed." };
  }

  try {
    const lock = await queryManaged<{ locked: boolean }>(
      managed,
      "SELECT pg_try_advisory_lock($1) AS locked",
      [IMPORT_ADVISORY_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      outcome = { ok: false, code: "IMPORT_LOCKED", message: "Another clients import is already running." };
    } else {
      phase.lockHeld = true;

      if (await hasStaleRunningImport(managed)) {
        outcome = {
          ok: false,
          code: "STALE_RUNNING_IMPORT",
          message: "A previous import run is still marked as running; resolve it before applying again.",
        };
      } else {
        const lastSuccessfulCount = await getLastSuccessfulRecordCount(managed);
        if (
          lastSuccessfulCount !== null &&
          options.payload.recordCount < lastSuccessfulCount
        ) {
          phase.runId = await insertRejectedRunJournal(managed, options.payload, "RECORD_COUNT_DECREASED");
          outcome = {
            ok: false,
            code: "RECORD_COUNT_DECREASED",
            message: "Source record count decreased compared to the last successful import.",
            runId: phase.runId,
          };
        } else {
          const runInsert = await queryManaged<{ id: string }>(
            managed,
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
          phase.runId = runInsert.rows[0]?.id;

          await queryManaged(managed, "BEGIN");

          const existing = await loadExistingClients(managed);
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

            await queryManaged(
              managed,
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

          await queryManaged(
            managed,
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
            [phase.runId, newCount, changedCount, unchangedCount],
          );

          phase.commitAttempted = true;
          if (options.testHooks?.failCommit) {
            throw new Error("Simulated commit response loss.");
          }

          await queryManaged(managed, "COMMIT");
          phase.commitConfirmed = true;
          phase.counts = { newCount, changedCount, unchangedCount };

          let postCommitCleanupWarning: string | undefined;
          try {
            await releaseAdvisoryLock(managed, options.testHooks);
            phase.lockHeld = false;
          } catch {
            postCommitCleanupWarning =
              "Import committed successfully but advisory lock release failed; verify no concurrent apply is running.";
          }

          outcome = {
            ok: true,
            runId: phase.runId!,
            counts: phase.counts,
            cleanupWarning: postCommitCleanupWarning,
          };
        }
      }
    }
  } catch (error) {
    if (isConnectionFault(error, managed)) {
      outcome = resolveConnectionFault(phase);
    } else if (phase.commitAttempted && !phase.commitConfirmed) {
      outcome = {
        ok: false,
        code: "COMMIT_UNCERTAIN",
        message: "Commit outcome is unknown; inspect the import run journal by runId before retrying.",
        runId: phase.runId,
      };
    } else {
      if (managed && !managed.faulted()) {
        try {
          await managed.client.query("ROLLBACK");
        } catch {
          // Rollback is best-effort; connection loss does not prove rollback.
        }

        if (phase.runId) {
          try {
            await managed.client.query(
              `
                UPDATE onec_client_import_runs
                SET status = 'failed', finished_at = NOW(), error_code = 'DATABASE_ERROR'
                WHERE id = $1 AND status = 'running'
              `,
              [phase.runId],
            );
          } catch {
            // ignore journal failure
          }
        }
      }

      outcome = { ok: false, code: "DATABASE_ERROR", message: "Database apply failed.", runId: phase.runId };
    }
  } finally {
    const unlockWarning = await safeUnlockAdvisoryLock(managed, phase.lockHeld);
    if (unlockWarning) {
      cleanupWarnings.push(unlockWarning);
      phase.lockHeld = false;
    }

    const releaseWarning = safeReleaseClient(managed, options.testHooks);
    if (releaseWarning) {
      cleanupWarnings.push(releaseWarning);
    }
    managed = undefined;

    const poolWarning = await safeEndPool(pool, options.testHooks);
    if (poolWarning) {
      cleanupWarnings.push(poolWarning);
    }
    pool = undefined;
  }

  return appendCleanupWarnings(
    outcome ?? { ok: false, code: "DATABASE_ERROR", message: "Database apply failed.", runId: phase.runId },
    cleanupWarnings,
  );
}
