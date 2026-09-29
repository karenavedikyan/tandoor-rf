import { Pool, type PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { createPgPoolOptions } from "../config/pg-ssl";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { applyClientsImport } from "../onec-clients/apply";
import { DB_CONNECT_TIMEOUT_MS } from "../onec-clients/apply";
import { type FtpReader } from "../onec-clients/ftp-read";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import { readStableClientsFile } from "../onec-clients/read-stable";
import type { ValidatedClientsPayload } from "../onec-clients/types";
import { loadScheduledExchangeConfig, type ScheduledExchangeConfig } from "./config";

export type ScheduledExchangeStage =
  | "config"
  | "lock"
  | "stable_read"
  | "check_only"
  | "apply"
  | "state_update";

export type ScheduledExchangeResult = {
  status:
    | "SUCCESS"
    | "CHECK_ONLY"
    | "SKIPPED_UNCHANGED"
    | "APPLY_DISABLED"
    | "BASELINE_REQUIRED"
    | "HASH_MISMATCH"
    | "CONFIG_ERROR"
    | "IMPORT_LOCKED"
    | "FTP_ERROR"
    | "TIMEOUT"
    | "VALIDATION_FAILED"
    | "UNSTABLE_SOURCE"
    | "APPLY_FAILED"
    | "DATABASE_ERROR";
  stage: ScheduledExchangeStage;
  durationMs: number;
  sha256?: string;
  recordCount?: number;
  readCount?: number;
  applyRunId?: string;
  errorCode?: string;
  message: string;
};

type ExchangeStateRow = {
  last_checked_at: Date | null;
  last_checked_sha256: string | null;
  last_successful_apply_at: Date | null;
  last_successful_apply_sha256: string | null;
  accepted_baseline_sha256: string | null;
};

async function insertAttemptJournal(
  client: PoolClient,
  input: {
    status: "running" | "success" | "failed" | "validation_failed";
    stage: ScheduledExchangeStage;
    sha256?: string;
    byteSize?: number;
    recordCount?: number;
    errorCode?: string;
    durationMs: number;
  },
): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO onec_client_import_runs (
        status,
        mode,
        trigger_source,
        stage,
        duration_ms,
        source_sha256,
        source_byte_size,
        source_record_count,
        error_code,
        finished_at
      )
      VALUES ($1, 'scheduled_check', 'scheduled', $2, $3, $4, $5, $6, $7, CASE WHEN $1 = 'running' THEN NULL ELSE NOW() END)
      RETURNING id::text
    `,
    [
      input.status === "running" ? "running" : input.status,
      input.stage,
      input.durationMs,
      input.sha256 ?? null,
      input.byteSize ?? null,
      input.recordCount ?? null,
      input.errorCode ?? null,
    ],
  );
  return result.rows[0]?.id;
}

async function loadExchangeState(client: PoolClient): Promise<ExchangeStateRow> {
  const result = await client.query<ExchangeStateRow>(
    `
      SELECT
        last_checked_at,
        last_checked_sha256,
        last_successful_apply_at,
        last_successful_apply_sha256,
        accepted_baseline_sha256
      FROM onec_exchange_state
      WHERE id = 1
    `,
  );
  return (
    result.rows[0] ?? {
      last_checked_at: null,
      last_checked_sha256: null,
      last_successful_apply_at: null,
      last_successful_apply_sha256: null,
      accepted_baseline_sha256: null,
    }
  );
}

async function updateExchangeState(
  client: PoolClient,
  input: Partial<{
    lastCheckedAt: Date;
    lastCheckedSha256: string;
    lastSuccessfulApplyAt: Date;
    lastSuccessfulApplySha256: string;
    acceptedBaselineSha256: string;
  }>,
): Promise<void> {
  await client.query(
    `
      UPDATE onec_exchange_state
      SET
        last_checked_at = COALESCE($1, last_checked_at),
        last_checked_sha256 = COALESCE($2, last_checked_sha256),
        last_successful_apply_at = COALESCE($3, last_successful_apply_at),
        last_successful_apply_sha256 = COALESCE($4, last_successful_apply_sha256),
        accepted_baseline_sha256 = COALESCE($5, accepted_baseline_sha256),
        updated_at = NOW()
      WHERE id = 1
    `,
    [
      input.lastCheckedAt ?? null,
      input.lastCheckedSha256 ?? null,
      input.lastSuccessfulApplyAt ?? null,
      input.lastSuccessfulApplySha256 ?? null,
      input.acceptedBaselineSha256 ?? null,
    ],
  );
}

function resolveApplyAuthorization(
  config: ScheduledExchangeConfig,
  state: ExchangeStateRow,
  payload: ValidatedClientsPayload,
): { ok: true } | { ok: false; code: "BASELINE_REQUIRED" | "HASH_MISMATCH"; message: string } {
  if (!config.applyEnabled) {
    return { ok: false, code: "HASH_MISMATCH", message: "Apply disabled." };
  }

  if (!state.last_successful_apply_at) {
    const baseline = config.acceptedBaselineSha256 ?? state.accepted_baseline_sha256;
    if (!baseline) {
      return {
        ok: false,
        code: "BASELINE_REQUIRED",
        message: "First scheduled apply requires ONEC_SCHEDULED_EXCHANGE_ACCEPTED_BASELINE_SHA256.",
      };
    }
    if (payload.sha256 !== baseline) {
      return {
        ok: false,
        code: "HASH_MISMATCH",
        message: "Source SHA-256 does not match accepted baseline.",
      };
    }
  }

  return { ok: true };
}

export async function runScheduledExchangeCycle(
  options: {
    env?: NodeJS.ProcessEnv;
    ftpReader?: FtpReader;
    config?: ScheduledExchangeConfig;
  } = {},
): Promise<ScheduledExchangeResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const config = options.config ?? loadScheduledExchangeConfig(env);

  const loadedConfig = loadOnecFtpConfig(env);
  if (!loadedConfig.ok) {
    return {
      status: "CONFIG_ERROR",
      stage: "config",
      durationMs: Date.now() - startedAt,
      errorCode: "CONFIG_ERROR",
      message: loadedConfig.message,
    };
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return {
      status: "DATABASE_ERROR",
      stage: "config",
      durationMs: Date.now() - startedAt,
      errorCode: "DATABASE_ERROR",
      message: "DATABASE_URL is required for scheduled exchange.",
    };
  }

  const pgOptions = createPgPoolOptions(databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });

  let client: PoolClient | undefined;
  let lockHeld = false;

  try {
    client = await pool.connect();
    lockHeld = await tryAcquireImportLock(client);
    if (!lockHeld) {
      return {
        status: "IMPORT_LOCKED",
        stage: "lock",
        durationMs: Date.now() - startedAt,
        errorCode: "IMPORT_LOCKED",
        message: "Another clients import or exchange cycle is already running.",
      };
    }

    let stableRead = await readStableClientsFile(loadedConfig.config, {
      reader: options.ftpReader,
      stabilityDelayMs: config.stabilityDelayMs,
      readDeadlineMs: config.readDeadlineMs,
    });

    for (let attempt = 0; !stableRead.ok && attempt < config.readRetries; attempt += 1) {
      stableRead = await readStableClientsFile(loadedConfig.config, {
        reader: options.ftpReader,
        stabilityDelayMs: config.stabilityDelayMs,
        readDeadlineMs: config.readDeadlineMs,
      });
    }

    if (!stableRead.ok) {
      await insertAttemptJournal(client, {
        status: stableRead.code === "VALIDATION_FAILED" ? "validation_failed" : "failed",
        stage: "stable_read",
        durationMs: Date.now() - startedAt,
        errorCode: stableRead.code,
        sha256: stableRead.firstSha256,
      });
      await updateExchangeState(client, { lastCheckedAt: new Date() });

      const statusMap = {
        FTP_ERROR: "FTP_ERROR",
        TIMEOUT: "TIMEOUT",
        VALIDATION_FAILED: "VALIDATION_FAILED",
        UNSTABLE_SOURCE: "UNSTABLE_SOURCE",
        HASH_MISMATCH: "VALIDATION_FAILED",
      } as const;

      return {
        status: statusMap[stableRead.code] ?? "FTP_ERROR",
        stage: "stable_read",
        durationMs: Date.now() - startedAt,
        readCount: stableRead.readCount,
        sha256: stableRead.firstSha256,
        errorCode: stableRead.code,
        message: stableRead.message,
      };
    }

    const payload = stableRead.payload;
    const state = await loadExchangeState(client);

    await updateExchangeState(client, {
      lastCheckedAt: new Date(),
      lastCheckedSha256: payload.sha256,
    });

    if (
      state.last_successful_apply_sha256 === payload.sha256 ||
      (state.last_checked_sha256 === payload.sha256 && !config.applyEnabled)
    ) {
      await insertAttemptJournal(client, {
        status: "success",
        stage: "check_only",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        durationMs: Date.now() - startedAt,
      });
      return {
        status: "SKIPPED_UNCHANGED",
        stage: "check_only",
        durationMs: Date.now() - startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        message: "Source unchanged since last successful check or apply.",
      };
    }

    if (!config.applyEnabled) {
      await insertAttemptJournal(client, {
        status: "success",
        stage: "check_only",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        durationMs: Date.now() - startedAt,
      });
      return {
        status: "CHECK_ONLY",
        stage: "check_only",
        durationMs: Date.now() - startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        message: "Stable source validated; scheduled apply is disabled.",
      };
    }

    const auth = resolveApplyAuthorization(config, state, payload);
    if (!auth.ok) {
      await insertAttemptJournal(client, {
        status: "failed",
        stage: "apply",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        durationMs: Date.now() - startedAt,
        errorCode: auth.code,
      });
      return {
        status: auth.code,
        stage: "apply",
        durationMs: Date.now() - startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        errorCode: auth.code,
        message: auth.message,
      };
    }

    await releaseImportLock(client);
    lockHeld = false;
    client.release();
    client = undefined;

    const applied = await applyClientsImport({ databaseUrl, payload });
    const reconnect = await pool.connect();
    client = reconnect;

    if (!applied.ok) {
      await insertAttemptJournal(client, {
        status: "failed",
        stage: "apply",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        durationMs: Date.now() - startedAt,
        errorCode: applied.code,
      });
      return {
        status: "APPLY_FAILED",
        stage: "apply",
        durationMs: Date.now() - startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        applyRunId: applied.runId,
        errorCode: applied.code,
        message: applied.message,
      };
    }

    await updateExchangeState(client, {
      lastSuccessfulApplyAt: new Date(),
      lastSuccessfulApplySha256: payload.sha256,
      acceptedBaselineSha256: state.accepted_baseline_sha256 ?? config.acceptedBaselineSha256 ?? payload.sha256,
    });

    await insertAttemptJournal(client, {
      status: "success",
      stage: "apply",
      sha256: payload.sha256,
      byteSize: payload.byteSize,
      recordCount: payload.recordCount,
      durationMs: Date.now() - startedAt,
    });

    return {
      status: "SUCCESS",
      stage: "apply",
      durationMs: Date.now() - startedAt,
      sha256: payload.sha256,
      recordCount: payload.recordCount,
      readCount: stableRead.readCount,
      applyRunId: applied.runId,
      message: "Scheduled exchange applied successfully.",
    };
  } catch {
    return {
      status: "DATABASE_ERROR",
      stage: "state_update",
      durationMs: Date.now() - startedAt,
      errorCode: "DATABASE_ERROR",
      message: "Scheduled exchange database operation failed.",
    };
  } finally {
    if (client) {
      if (lockHeld) {
        try {
          await releaseImportLock(client);
        } catch {
          // ignore unlock failure
        }
      }
      client.release();
    }
    await pool.end();
  }
}
