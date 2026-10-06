import { getPool } from "../../db/pool";
import { REGULAR_UPDATE_JOB_KIND } from "../../onec-import/constants";
import type { RegularUpdateResult } from "../../onec-regular-update/types";
import { formatMskDateTime } from "../dto";
import type { AdminOnecUpdateJobDto, OnecUpdateUiPhase } from "./types";
import { MANIFEST_UNAVAILABLE_USER_MESSAGE } from "../../onec-import/regular-update-job";

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

function mapResultMessage(result: RegularUpdateResult | null, errorCode: string | null): string {
  if (errorCode === "RELEASE_CONSISTENCY_NOT_CONFIRMED") {
    return MANIFEST_UNAVAILABLE_USER_MESSAGE;
  }
  if (result?.message) {
    return result.message;
  }
  if (errorCode === "IMPORT_JOB_FAILED") {
    return "Не удалось выполнить обновление из 1С.";
  }
  return "Статус обновления неизвестен.";
}

function mapUiPhase(status: JobRow["status"], result: RegularUpdateResult | null): OnecUpdateUiPhase {
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

function dataPreserved(phase: OnecUpdateUiPhase): boolean {
  return phase === "rejected" || phase === "error";
}

export function mapJobRowToDto(
  row: JobRow,
  lastSuccessfulUpdateAt: Date | null,
): AdminOnecUpdateJobDto {
  const phase = mapUiPhase(row.status, row.result);
  const sourceExportAt = row.result?.sourceExportAt ?? null;
  return {
    id: row.id,
    phase,
    message: mapResultMessage(row.result, row.error_code),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    sourceExportAt,
    sourceExportAtLabel: sourceExportAt ? formatMskDateTime(new Date(sourceExportAt)) : null,
    lastSuccessfulUpdateAt: lastSuccessfulUpdateAt?.toISOString() ?? null,
    lastSuccessfulUpdateAtLabel: lastSuccessfulUpdateAt
      ? formatMskDateTime(lastSuccessfulUpdateAt)
      : null,
    dataPreserved: dataPreserved(phase),
    errorCode: row.error_code ?? row.result?.errorCode ?? null,
    requestedByUserId: row.requested_by_user_id,
  };
}

export async function loadLatestRegularUpdateJob(): Promise<JobRow | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }
  const result = await pool.query<JobRow>(
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
  return result.rows[0] ?? null;
}

export async function loadActiveRegularUpdateJob(): Promise<JobRow | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }
  const result = await pool.query<JobRow>(
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
        AND status IN ('pending', 'running')
        AND expires_at > NOW()
      ORDER BY requested_at DESC, id DESC
      LIMIT 1
    `,
    [REGULAR_UPDATE_JOB_KIND],
  );
  return result.rows[0] ?? null;
}

export async function countRunningImportRuns(): Promise<number> {
  const pool = getPool();
  if (!pool) {
    return 0;
  }
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM onec_client_import_runs WHERE status = 'running'`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function isExchangeApplyBlocked(): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    return false;
  }
  const result = await pool.query<{ apply_blocked: boolean }>(
    `SELECT apply_blocked FROM onec_exchange_state WHERE id = 1`,
  );
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

export async function insertRegularUpdateJob(requestedByUserId: string): Promise<string> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_UNAVAILABLE");
  }
  const inserted = await pool.query<{ id: string }>(
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
  return jobId;
}
