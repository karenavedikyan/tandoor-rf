import { Pool, type PoolClient } from "pg";
import { getDatabaseUrl } from "../config";
import { createPgPoolOptions } from "../config/pg-ssl";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { applyClientsImport, DB_CONNECT_TIMEOUT_MS } from "../onec-clients/apply";
import { type FtpReader } from "../onec-clients/ftp-read";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import { readStableClientsFile } from "../onec-clients/read-stable";
import type { ValidatedClientsPayload } from "../onec-clients/types";
import {
  ensureExchangeStateInitialized,
  getCommittedSnapshotSha,
  loadExchangeState,
  markExchangeAttempt,
  markExchangeVerified,
} from "../onec-exchange/state";
import { prepareJournalWarnings } from "../onec-exchange/warnings-journal";
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
    | "PENDING_APPLY"
    | "SKIPPED_UNCHANGED"
    | "BASELINE_REQUIRED"
    | "HASH_MISMATCH"
    | "CONFIG_ERROR"
    | "IMPORT_LOCKED"
    | "APPLY_BLOCKED"
    | "SUPERSEDED_BY_NEWER_IMPORT"
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
  checkRunId?: string;
  errorCode?: string;
  message: string;
};

async function insertCycleJournal(
  client: PoolClient,
  input: {
    id?: string;
    status: "running" | "success" | "failed" | "validation_failed";
    stage: ScheduledExchangeStage;
    sha256?: string;
    byteSize?: number;
    recordCount?: number;
    warningCount?: number;
    warningsJson?: string;
    warningsTruncated?: boolean;
    errorCode?: string;
    durationMs?: number;
    parentRunId?: string;
  },
): Promise<string> {
  if (input.id) {
    await client.query(
      `
        UPDATE onec_client_import_runs
        SET
          status = $2,
          stage = $3,
          source_sha256 = COALESCE($4, source_sha256),
          source_byte_size = COALESCE($5, source_byte_size),
          source_record_count = COALESCE($6, source_record_count),
          warning_count = COALESCE($7, warning_count),
          warnings = COALESCE($8::jsonb, warnings),
          warnings_truncated = COALESCE($9, warnings_truncated),
          error_code = $10,
          duration_ms = COALESCE($11, duration_ms),
          finished_at = CASE WHEN $2 = 'running' THEN NULL ELSE NOW() END
        WHERE id = $1::uuid
      `,
      [
        input.id,
        input.status === "running" ? "running" : input.status,
        input.stage,
        input.sha256 ?? null,
        input.byteSize ?? null,
        input.recordCount ?? null,
        input.warningCount ?? null,
        input.warningsJson ?? null,
        input.warningsTruncated ?? null,
        input.errorCode ?? null,
        input.durationMs ?? null,
      ],
    );
    return input.id;
  }

  const result = await client.query<{ id: string }>(
    `
      INSERT INTO onec_client_import_runs (
        status,
        mode,
        trigger_source,
        stage,
        parent_run_id,
        source_sha256,
        source_byte_size,
        source_record_count,
        warning_count,
        warnings,
        warnings_truncated,
        error_code,
        duration_ms,
        finished_at
      )
      VALUES (
        $1,
        'scheduled_check',
        'scheduled',
        $2,
        $3::uuid,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        $9,
        $10,
        $11,
        CASE WHEN $1 = 'running' THEN NULL ELSE NOW() END
      )
      RETURNING id::text
    `,
    [
      input.status === "running" ? "running" : input.status,
      input.stage,
      input.parentRunId ?? null,
      input.sha256 ?? null,
      input.byteSize ?? null,
      input.recordCount ?? null,
      input.warningCount ?? null,
      input.warningsJson ?? null,
      input.warningsTruncated ?? false,
      input.errorCode ?? null,
      input.durationMs ?? null,
    ],
  );
  return result.rows[0]!.id;
}

function resolveApplyAuthorization(
  config: ScheduledExchangeConfig,
  committedSha: string | null,
  state: Awaited<ReturnType<typeof loadExchangeState>>,
  payload: ValidatedClientsPayload,
): { ok: true } | { ok: false; code: "BASELINE_REQUIRED" | "HASH_MISMATCH"; message: string } {
  if (!config.applyEnabled) {
    return { ok: false, code: "HASH_MISMATCH", message: "Apply disabled." };
  }

  if (!committedSha) {
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

function failureResult(
  input: Omit<ScheduledExchangeResult, "durationMs"> & { startedAt: number },
): ScheduledExchangeResult {
  return { ...input, durationMs: Date.now() - input.startedAt };
}

function journalizePayloadWarnings(payload: ValidatedClientsPayload) {
  const prepared = prepareJournalWarnings(payload.warnings, {
    totalWarningCount: payload.warningCount,
  });
  return {
    warningCount: prepared.warningCount,
    warningsJson: prepared.warningsJson,
    warningsTruncated: prepared.warningsTruncated,
  };
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

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return failureResult({
      status: "DATABASE_ERROR",
      stage: "config",
      startedAt,
      errorCode: "DATABASE_ERROR",
      message: "DATABASE_URL is required for scheduled exchange.",
    });
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
  let cycleRunId: string | undefined;

  try {
    client = await pool.connect();

    const loadedConfig = loadOnecFtpConfig(env);
    if (!loadedConfig.ok) {
      cycleRunId = await insertCycleJournal(client, {
        status: "failed",
        stage: "config",
        errorCode: "CONFIG_ERROR",
        durationMs: Date.now() - startedAt,
      });
      return failureResult({
        status: "CONFIG_ERROR",
        stage: "config",
        startedAt,
        checkRunId: cycleRunId,
        errorCode: "CONFIG_ERROR",
        message: loadedConfig.message,
      });
    }

    await markExchangeAttempt(client);

    lockHeld = await tryAcquireImportLock(client);
    if (!lockHeld) {
      cycleRunId = await insertCycleJournal(client, {
        status: "failed",
        stage: "lock",
        errorCode: "IMPORT_LOCKED",
        durationMs: Date.now() - startedAt,
      });
      return failureResult({
        status: "IMPORT_LOCKED",
        stage: "lock",
        startedAt,
        checkRunId: cycleRunId,
        errorCode: "IMPORT_LOCKED",
        message: "Another clients import or exchange cycle is already running.",
      });
    }

    cycleRunId = await insertCycleJournal(client, {
      status: "running",
      stage: "lock",
    });

    await ensureExchangeStateInitialized(client);
    const committedBeforeRead = await getCommittedSnapshotSha(client);

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
      await insertCycleJournal(client, {
        id: cycleRunId,
        status: stableRead.code === "VALIDATION_FAILED" ? "validation_failed" : "failed",
        stage: "stable_read",
        sha256: stableRead.firstSha256,
        errorCode: stableRead.code,
        durationMs: Date.now() - startedAt,
      });

      const statusMap = {
        FTP_ERROR: "FTP_ERROR",
        TIMEOUT: "TIMEOUT",
        VALIDATION_FAILED: "VALIDATION_FAILED",
        UNSTABLE_SOURCE: "UNSTABLE_SOURCE",
        HASH_MISMATCH: "VALIDATION_FAILED",
      } as const;

      return failureResult({
        status: statusMap[stableRead.code] ?? "FTP_ERROR",
        stage: "stable_read",
        startedAt,
        readCount: stableRead.readCount,
        sha256: stableRead.firstSha256,
        checkRunId: cycleRunId,
        errorCode: stableRead.code,
        message: stableRead.message,
      });
    }

    const payload = stableRead.payload;
    const payloadWarnings = journalizePayloadWarnings(payload);
    await markExchangeVerified(client, { sha256: payload.sha256 });

    await insertCycleJournal(client, {
      id: cycleRunId,
      status: "running",
      stage: "stable_read",
      sha256: payload.sha256,
      byteSize: payload.byteSize,
      recordCount: payload.recordCount,
      warningCount: payloadWarnings.warningCount,
      warningsJson: payloadWarnings.warningsJson,
      warningsTruncated: payloadWarnings.warningsTruncated,
    });

    if (payload.sha256 === committedBeforeRead) {
      await insertCycleJournal(client, {
        id: cycleRunId,
        status: "success",
        stage: "check_only",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        warningCount: payloadWarnings.warningCount,
        warningsJson: payloadWarnings.warningsJson,
        warningsTruncated: payloadWarnings.warningsTruncated,
        durationMs: Date.now() - startedAt,
      });
      return failureResult({
        status: "SKIPPED_UNCHANGED",
        stage: "check_only",
        startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        checkRunId: cycleRunId,
        message: "Source matches the last committed snapshot in the database.",
      });
    }

    if (!config.applyEnabled) {
      await insertCycleJournal(client, {
        id: cycleRunId,
        status: "success",
        stage: "check_only",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        warningCount: payloadWarnings.warningCount,
        warningsJson: payloadWarnings.warningsJson,
        warningsTruncated: payloadWarnings.warningsTruncated,
        durationMs: Date.now() - startedAt,
      });
      return failureResult({
        status: committedBeforeRead ? "PENDING_APPLY" : "CHECK_ONLY",
        stage: "check_only",
        startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        checkRunId: cycleRunId,
        message: committedBeforeRead
          ? "New source verified on FTP; scheduled apply is disabled and LK data was not updated."
          : "Stable source validated; scheduled apply is disabled.",
      });
    }

    const state = await loadExchangeState(client);
    const auth = resolveApplyAuthorization(config, committedBeforeRead, state, payload);
    if (!auth.ok) {
      await insertCycleJournal(client, {
        id: cycleRunId,
        status: "failed",
        stage: "apply",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        errorCode: auth.code,
        durationMs: Date.now() - startedAt,
      });
      return failureResult({
        status: auth.code,
        stage: "apply",
        startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        checkRunId: cycleRunId,
        errorCode: auth.code,
        message: auth.message,
      });
    }

    const applied = await applyClientsImport({
      databaseUrl,
      client,
      payload,
      lockAlreadyHeld: true,
      retainLock: false,
      triggerSource: "scheduled",
      parentRunId: cycleRunId,
      excludeRunIds: cycleRunId ? [cycleRunId] : [],
      expectedCommittedSha256: committedBeforeRead,
      syncExchangeState: true,
    });
    lockHeld = false;

    if (!applied.ok) {
      await insertCycleJournal(client, {
        id: cycleRunId,
        status: "failed",
        stage: "apply",
        sha256: payload.sha256,
        byteSize: payload.byteSize,
        recordCount: payload.recordCount,
        errorCode: applied.code,
        durationMs: Date.now() - startedAt,
      });
      const statusMap = {
        SUPERSEDED_BY_NEWER_IMPORT: "SUPERSEDED_BY_NEWER_IMPORT",
        APPLY_BLOCKED: "APPLY_BLOCKED",
      } as const;
      return failureResult({
        status: statusMap[applied.code as keyof typeof statusMap] ?? "APPLY_FAILED",
        stage: "apply",
        startedAt,
        sha256: payload.sha256,
        recordCount: payload.recordCount,
        readCount: stableRead.readCount,
        applyRunId: applied.runId,
        checkRunId: cycleRunId,
        errorCode: applied.code,
        message: applied.message,
      });
    }

    await insertCycleJournal(client, {
      id: cycleRunId,
      status: "success",
      stage: "apply",
      sha256: payload.sha256,
      byteSize: payload.byteSize,
      recordCount: payload.recordCount,
      warningCount: payloadWarnings.warningCount,
      warningsJson: payloadWarnings.warningsJson,
      warningsTruncated: payloadWarnings.warningsTruncated,
      durationMs: Date.now() - startedAt,
    });

    return failureResult({
      status: "SUCCESS",
      stage: "apply",
      startedAt,
      sha256: payload.sha256,
      recordCount: payload.recordCount,
      readCount: stableRead.readCount,
      applyRunId: applied.runId,
      checkRunId: cycleRunId,
      message: "Scheduled exchange applied successfully.",
    });
  } catch {
    if (client && cycleRunId) {
      try {
        await insertCycleJournal(client, {
          id: cycleRunId,
          status: "failed",
          stage: "state_update",
          errorCode: "DATABASE_ERROR",
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // ignore secondary journal failure
      }
    }
    return failureResult({
      status: "DATABASE_ERROR",
      stage: "state_update",
      startedAt,
      checkRunId: cycleRunId,
      errorCode: "DATABASE_ERROR",
      message: "Scheduled exchange database operation failed.",
    });
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
