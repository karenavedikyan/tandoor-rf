import type { PoolClient } from "pg";
import { NIGHTLY_WINDOW_MISSED_CODE } from "../clients/admin-onec-update/nightly-job-lifecycle";
import { REGULAR_UPDATE_JOB_SOURCE_NIGHTLY } from "../onec-import/constants";

export const IMPORT_JOB_SUPERSEDED_CODE = "IMPORT_JOB_SUPERSEDED" as const;

export type ImportJobRunnableFailureCode =
  | typeof IMPORT_JOB_SUPERSEDED_CODE
  | typeof NIGHTLY_WINDOW_MISSED_CODE;

export type ImportJobRunnableCheck =
  | { runnable: true }
  | { runnable: false; code: ImportJobRunnableFailureCode };

export async function checkOperatorImportJobRunnable(
  client: PoolClient,
  jobId: string,
): Promise<ImportJobRunnableCheck> {
  const result = await client.query<{
    status: string;
    job_source: string;
    nightly_window_deadline_at: Date | null;
  }>(
    `
      SELECT status, job_source, nightly_window_deadline_at
      FROM onec_import_jobs
      WHERE id = $1::uuid
    `,
    [jobId],
  );
  const row = result.rows[0];
  if (!row || row.status !== "running") {
    return { runnable: false, code: IMPORT_JOB_SUPERSEDED_CODE };
  }
  if (
    row.job_source === REGULAR_UPDATE_JOB_SOURCE_NIGHTLY &&
    row.nightly_window_deadline_at &&
    row.nightly_window_deadline_at <= new Date()
  ) {
    return { runnable: false, code: NIGHTLY_WINDOW_MISSED_CODE };
  }
  return { runnable: true };
}

/** @deprecated Prefer checkOperatorImportJobRunnable for nightly window handling. */
export async function assertOperatorImportJobRunnable(
  client: PoolClient,
  jobId: string,
): Promise<boolean> {
  const check = await checkOperatorImportJobRunnable(client, jobId);
  return check.runnable;
}

export async function markOperatorImportJobSuperseded(
  client: PoolClient,
  jobId: string,
): Promise<void> {
  await client.query(
    `
      UPDATE onec_import_jobs
      SET
        status = 'failed',
        finished_at = NOW(),
        error_code = $2,
        result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
          'errorCode', $2,
          'message', 'Import job is no longer runnable.'
        )
      WHERE id = $1::uuid AND status = 'running'
    `,
    [jobId, IMPORT_JOB_SUPERSEDED_CODE],
  );
}

export async function markOperatorImportJobWindowMissed(
  client: PoolClient,
  jobId: string,
): Promise<void> {
  await client.query(
    `
      UPDATE onec_import_jobs
      SET
        status = 'failed',
        finished_at = NOW(),
        error_code = $2,
        result = jsonb_build_object(
          'status', 'ERROR',
          'mode', 'apply',
          'errorCode', $2,
          'message', 'Ночное окно обмена с 1С уже закрыто; автоматический запуск пропущен.'
        )
      WHERE id = $1::uuid AND status = 'running'
    `,
    [jobId, NIGHTLY_WINDOW_MISSED_CODE],
  );
}
