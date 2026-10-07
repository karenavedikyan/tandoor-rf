import type { PoolClient } from "pg";
import { getPool } from "../../db/pool";
import {
  REGULAR_UPDATE_JOB_KIND,
  REGULAR_UPDATE_JOB_SOURCE_ADMIN,
  type RegularUpdateJobSource,
} from "../../onec-import/constants";
import type { RegularUpdateResult } from "../../onec-regular-update/types";
import { formatMskDateTime } from "../dto";
import type { AdminOnecUpdateJobDto, OnecUpdateUiPhase } from "./types";
import { MANIFEST_UNAVAILABLE_USER_MESSAGE } from "../../onec-import/regular-update-job";
import { finalizeStaleRegularUpdateJobs } from "./job-lifecycle";

const REGULAR_UPDATE_ADMIN_LOCK = 902_451_004;

type JobRow = {
  id: string;
  status: "pending" | "running" | "success" | "failed";
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  result: RegularUpdateResult | null;
  error_code: string | null;
  requested_by_user_id: string | null;
  job_source: RegularUpdateJobSource;
};

export type StartRegularUpdateJobResult =
  | { ok: true; jobId: string }
  | {
      ok: false;
      code: "UPDATE_ALREADY_RUNNING" | "APPLY_BLOCKED" | "IMPORT_RUNNING";
      message: string;
      existingJobId?: string;
    };

export type EnqueueRegularUpdateJobInput =
  | { jobSource: typeof REGULAR_UPDATE_JOB_SOURCE_ADMIN; requestedByUserId: string }
  | {
      jobSource: "nightly";
      windowKey: string;
      windowDeadlineAt: Date;
      /** Wall clock at enqueue (MSK window evaluation instant). */
      requestedAt: Date;
    };

const JOB_SOURCE_LABELS: Record<RegularUpdateJobSource, string> = {
  admin_manual: "Вручную администратором",
  nightly: "Ночной обмен",
};

function resolveErrorCode(row: JobRow): string | null {
  return row.error_code ?? row.result?.errorCode ?? null;
}

function mapResultMessage(result: RegularUpdateResult | null, errorCode: string | null): string {
  if (errorCode === "COMMIT_UNCERTAIN") {
    return "Результат обновления уточняется. Повторный запуск заблокирован до проверки оператором.";
  }
  if (errorCode === "RELEASE_CONSISTENCY_NOT_CONFIRMED") {
    return MANIFEST_UNAVAILABLE_USER_MESSAGE;
  }
  if (errorCode === "JOB_EXPIRED") {
    return "Срок ожидания задания обновления из 1С истёк. Можно запустить обновление снова.";
  }
  if (errorCode === "NIGHTLY_WINDOW_MISSED") {
    return "Ночное окно обмена с 1С уже закрыто; автоматический запуск пропущен.";
  }
  if (errorCode === "NIGHTLY_SCHEDULE_DISABLED") {
    return "Ночной обмен с 1С отключён; ожидающее задание не будет выполнено автоматически.";
  }
  if (result?.message) {
    return result.message;
  }
  if (errorCode === "IMPORT_JOB_FAILED") {
    return "Не удалось выполнить обновление из 1С.";
  }
  return "Статус обновления неизвестен.";
}

function mapUiPhase(status: JobRow["status"], result: RegularUpdateResult | null, errorCode: string | null): OnecUpdateUiPhase {
  if (errorCode === "COMMIT_UNCERTAIN") {
    return "uncertain";
  }
  if (status === "pending") {
    return "pending";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "success") {
    if (result?.status === "NO_CHANGES") {
      return "no_changes";
    }
    return "completed";
  }
  if (result?.status === "REJECTED_BY_CHECKS") {
    return "rejected";
  }
  return "error";
}

const DATA_PRESERVED_REJECTION_CODES = new Set([
  "RELEASE_CONSISTENCY_NOT_CONFIRMED",
  "MANIFEST_NOT_FOUND",
  "MANIFEST_UNREADABLE",
  "MANIFEST_INVALID_JSON",
  "MANIFEST_INVALID_SCHEMA",
  "MANIFEST_HASH_MISMATCH",
  "RECORD_COUNT_DECREASED",
  "GUID_SET_SHRINK",
  "ROSTER_SHRINK_AMBIGUOUS",
  "VERIFICATION_FINGERPRINT_MISMATCH",
  "VERIFICATION_FINGERPRINT_REQUIRED",
  "VERIFICATION_PARAMETERS_MISMATCH",
  "APPLY_BLOCKED",
  "STALE_RUNNING_IMPORT",
  "IMPORT_LOCKED",
]);

function dataPreserved(phase: OnecUpdateUiPhase, errorCode: string | null): boolean {
  if (phase === "uncertain") {
    return false;
  }
  if (errorCode === "COMMIT_UNCERTAIN") {
    return false;
  }
  if (phase === "rejected" && errorCode && DATA_PRESERVED_REJECTION_CODES.has(errorCode)) {
    return true;
  }
  return false;
}

export function mapJobRowToDto(
  row: JobRow,
  lastSuccessfulUpdateAt: Date | null,
): AdminOnecUpdateJobDto {
  const errorCode = resolveErrorCode(row);
  const phase = mapUiPhase(row.status, row.result, errorCode);
  const sourceExportAt = row.result?.sourceExportAt ?? null;
  return {
    id: row.id,
    phase,
    message: mapResultMessage(row.result, errorCode),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    sourceExportAt,
    sourceExportAtLabel: sourceExportAt ? formatMskDateTime(new Date(sourceExportAt)) : null,
    lastSuccessfulUpdateAt: lastSuccessfulUpdateAt?.toISOString() ?? null,
    lastSuccessfulUpdateAtLabel: lastSuccessfulUpdateAt
      ? formatMskDateTime(lastSuccessfulUpdateAt)
      : null,
    dataPreserved: dataPreserved(phase, errorCode),
    errorCode,
    requestedByUserId: row.requested_by_user_id,
    jobSource: row.job_source,
    jobSourceLabel: JOB_SOURCE_LABELS[row.job_source],
    exportBatchId: row.result?.exportBatchId ?? null,
  };
}

const JOB_ROW_SELECT = `
  id::text,
  status,
  requested_at,
  started_at,
  finished_at,
  result,
  error_code,
  requested_by_user_id::text,
  job_source
`;

async function queryActiveRegularUpdateJob(client: PoolClient): Promise<JobRow | null> {
  const result = await client.query<JobRow>(
    `
      SELECT ${JOB_ROW_SELECT}
      FROM onec_import_jobs
      WHERE kind = $1
        AND (
          (status = 'pending' AND expires_at > NOW())
          OR status = 'running'
        )
      ORDER BY requested_at DESC, id DESC
      LIMIT 1
    `,
    [REGULAR_UPDATE_JOB_KIND],
  );
  return result.rows[0] ?? null;
}

export async function loadLatestRegularUpdateJob(): Promise<JobRow | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await finalizeStaleRegularUpdateJobs(client);
    const result = await client.query<JobRow>(
      `
        SELECT ${JOB_ROW_SELECT}
        FROM onec_import_jobs
        WHERE kind = $1
        ORDER BY requested_at DESC, id DESC
        LIMIT 1
      `,
      [REGULAR_UPDATE_JOB_KIND],
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadActiveRegularUpdateJob(): Promise<JobRow | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await finalizeStaleRegularUpdateJobs(client);
    const active = await queryActiveRegularUpdateJob(client);
    await client.query("COMMIT");
    return active;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function countRunningImportRuns(client?: PoolClient): Promise<number> {
  const query = `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE status = 'running'`;
  if (client) {
    const result = await client.query<{ count: string }>(query);
    return Number(result.rows[0]?.count ?? "0");
  }
  const pool = getPool();
  if (!pool) {
    return 0;
  }
  const result = await pool.query<{ count: string }>(query);
  return Number(result.rows[0]?.count ?? "0");
}

export async function isExchangeApplyBlocked(client?: PoolClient): Promise<boolean> {
  const query = `SELECT apply_blocked FROM onec_exchange_state WHERE id = 1`;
  if (client) {
    const result = await client.query<{ apply_blocked: boolean }>(query);
    return result.rows[0]?.apply_blocked === true;
  }
  const pool = getPool();
  if (!pool) {
    return false;
  }
  const result = await pool.query<{ apply_blocked: boolean }>(query);
  return result.rows[0]?.apply_blocked === true;
}

export async function loadLastSuccessfulUpdateAt(): Promise<Date | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }
  const exchange = await pool.query<{ last_successful_apply_at: Date | null }>(
    `SELECT last_successful_apply_at FROM onec_exchange_state WHERE id = 1`,
  );
  if (exchange.rows[0]?.last_successful_apply_at) {
    return exchange.rows[0].last_successful_apply_at;
  }
  const run = await pool.query<{ finished_at: Date }>(
    `
      SELECT finished_at
      FROM onec_client_import_runs
      WHERE status = 'success' AND mode = 'apply'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
  );
  return run.rows[0]?.finished_at ?? null;
}

async function enqueueRegularUpdateJobOnClient(
  client: PoolClient,
  input: EnqueueRegularUpdateJobInput,
): Promise<StartRegularUpdateJobResult> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [REGULAR_UPDATE_ADMIN_LOCK]);
  await finalizeStaleRegularUpdateJobs(client);

  const active = await queryActiveRegularUpdateJob(client);
  if (active) {
    return {
      ok: false,
      code: "UPDATE_ALREADY_RUNNING",
      message: "Обновление из 1С уже поставлено в очередь или выполняется.",
      existingJobId: active.id,
    };
  }

  if ((await countRunningImportRuns(client)) > 0) {
    return {
      ok: false,
      code: "IMPORT_RUNNING",
      message: "Другой импорт уже выполняется.",
    };
  }

  if (await isExchangeApplyBlocked(client)) {
    return {
      ok: false,
      code: "APPLY_BLOCKED",
      message: "Импорт временно заблокирован до разрешения предыдущей неопределённой операции.",
    };
  }

  const requestedByUserId =
    input.jobSource === REGULAR_UPDATE_JOB_SOURCE_ADMIN ? input.requestedByUserId : null;

  const requestedAt =
    input.jobSource === "nightly" ? input.requestedAt : new Date();
  const nightlyWindow =
    input.jobSource === "nightly"
      ? { key: input.windowKey, deadlineAt: input.windowDeadlineAt }
      : null;
  const genericExpiryMs = requestedAt.getTime() + 2 * 60 * 60 * 1000;
  const expiresAt = nightlyWindow
    ? new Date(Math.min(genericExpiryMs, nightlyWindow.deadlineAt.getTime()))
    : new Date(genericExpiryMs);
  if (expiresAt.getTime() <= requestedAt.getTime()) {
    throw new Error("NIGHTLY_WINDOW_ALREADY_CLOSED");
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO onec_import_jobs (
        kind,
        mode,
        status,
        requested_at,
        expires_at,
        requested_by_user_id,
        job_source,
        nightly_window_key,
        nightly_window_deadline_at
      )
      VALUES ($1, 'apply', 'pending', $4, $5, $2::uuid, $3, $6, $7)
      RETURNING id::text
    `,
    [
      REGULAR_UPDATE_JOB_KIND,
      requestedByUserId,
      input.jobSource,
      requestedAt,
      expiresAt,
      nightlyWindow?.key ?? null,
      nightlyWindow?.deadlineAt ?? null,
    ],
  );
  const jobId = inserted.rows[0]?.id;
  if (!jobId) {
    throw new Error("JOB_INSERT_FAILED");
  }
  return { ok: true, jobId };
}

/** Atomic enqueue for admin manual or nightly scheduler; optional client joins caller transaction. */
export async function tryEnqueueRegularUpdateJob(
  input: EnqueueRegularUpdateJobInput,
  existingClient?: PoolClient,
): Promise<StartRegularUpdateJobResult> {
  if (existingClient) {
    return enqueueRegularUpdateJobOnClient(existingClient, input);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await enqueueRegularUpdateJobOnClient(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function tryStartRegularUpdateJob(
  requestedByUserId: string,
): Promise<StartRegularUpdateJobResult> {
  return tryEnqueueRegularUpdateJob({
    jobSource: REGULAR_UPDATE_JOB_SOURCE_ADMIN,
    requestedByUserId,
  });
}
