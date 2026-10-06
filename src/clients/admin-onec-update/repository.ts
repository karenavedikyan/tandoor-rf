import type { PoolClient } from "pg";
import { getPool } from "../../db/pool";
import { REGULAR_UPDATE_JOB_KIND } from "../../onec-import/constants";
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
};

export type StartRegularUpdateJobResult =
  | { ok: true; jobId: string }
  | {
      ok: false;
      code: "UPDATE_ALREADY_RUNNING" | "APPLY_BLOCKED" | "IMPORT_RUNNING";
      message: string;
      existingJobId?: string;
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
  };
}

async function queryActiveRegularUpdateJob(client: PoolClient): Promise<JobRow | null> {
  const result = await client.query<JobRow>(
    `
      SELECT
        id::text,
        status,
        requested_at,
        started_at,
        finished_at,
        result,
        error_code,
        requested_by_user_id::text
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
        SELECT
          id::text,
          status,
          requested_at,
          started_at,
          finished_at,
          result,
          error_code,
          requested_by_user_id::text
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

export async function tryStartRegularUpdateJob(
  requestedByUserId: string,
): Promise<StartRegularUpdateJobResult> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [REGULAR_UPDATE_ADMIN_LOCK]);
    await finalizeStaleRegularUpdateJobs(client);

    const active = await queryActiveRegularUpdateJob(client);
    if (active) {
      await client.query("COMMIT");
      return {
        ok: false,
        code: "UPDATE_ALREADY_RUNNING",
        message: "Обновление из 1С уже поставлено в очередь или выполняется.",
        existingJobId: active.id,
      };
    }

    if ((await countRunningImportRuns(client)) > 0) {
      await client.query("COMMIT");
      return {
        ok: false,
        code: "IMPORT_RUNNING",
        message: "Другой импорт уже выполняется.",
      };
    }

    if (await isExchangeApplyBlocked(client)) {
      await client.query("COMMIT");
      return {
        ok: false,
        code: "APPLY_BLOCKED",
        message: "Импорт временно заблокирован до разрешения предыдущей неопределённой операции.",
      };
    }

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO onec_import_jobs (
          kind,
          mode,
          status,
          expires_at,
          requested_by_user_id
        )
        VALUES ($1, 'apply', 'pending', NOW() + INTERVAL '2 hours', $2::uuid)
        RETURNING id::text
      `,
      [REGULAR_UPDATE_JOB_KIND, requestedByUserId],
    );
    const jobId = inserted.rows[0]?.id;
    if (!jobId) {
      throw new Error("JOB_INSERT_FAILED");
    }
    await client.query("COMMIT");
    return { ok: true, jobId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
