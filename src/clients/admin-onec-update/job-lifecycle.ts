import type { PoolClient } from "pg";
import { REGULAR_UPDATE_JOB_KIND } from "../../onec-import/constants";

export const JOB_EXPIRED_CODE = "JOB_EXPIRED";

const STALE_JOB_RESULT = (errorCode: string, message: string) =>
  JSON.stringify({
    status: "ERROR",
    mode: "apply",
    errorCode,
    message,
  });

async function reconcileRunningRegularUpdateJob(
  client: PoolClient,
  jobId: string,
  importRunId: string,
): Promise<boolean> {
  const run = await client.query<{ status: string; error_code: string | null }>(
    `
      SELECT status, error_code
      FROM onec_client_import_runs
      WHERE id = $1::uuid
    `,
    [importRunId],
  );
  const runStatus = run.rows[0]?.status;
  if (runStatus === "success") {
    await client.query(
      `
        UPDATE onec_import_jobs
        SET status = 'success', finished_at = NOW(), error_code = NULL
        WHERE id = $1::uuid AND status = 'running'
      `,
      [jobId],
    );
    return true;
  }
  if (runStatus === "failed") {
    await client.query(
      `
        UPDATE onec_import_jobs
        SET
          status = 'failed',
          finished_at = NOW(),
          error_code = COALESCE($2, 'IMPORT_RUN_FAILED'),
          result = jsonb_build_object(
            'status', 'ERROR',
            'mode', 'apply',
            'errorCode', COALESCE($2, 'IMPORT_RUN_FAILED'),
            'message', 'Импорт завершился с ошибкой до восстановления статуса задания.'
          )
        WHERE id = $1::uuid AND status = 'running'
      `,
      [jobId, run.rows[0]?.error_code],
    );
    return true;
  }
  return false;
}

/** Finalize expired pending jobs and reconcile running jobs from linked import runs. */
export async function finalizeStaleRegularUpdateJobs(client: PoolClient): Promise<void> {
  await client.query(
    `
      UPDATE onec_import_jobs AS jobs
      SET
        status = 'failed',
        finished_at = NOW(),
        error_code = $2,
        result = $3::jsonb
      WHERE jobs.kind = $1
        AND jobs.status = 'pending'
        AND jobs.expires_at <= NOW()
    `,
    [
      REGULAR_UPDATE_JOB_KIND,
      JOB_EXPIRED_CODE,
      STALE_JOB_RESULT(
        JOB_EXPIRED_CODE,
        "Срок ожидания задания обновления из 1С истёк. Можно запустить обновление снова.",
      ),
    ],
  );

  const runningJobs = await client.query<{
    id: string;
    import_run_id: string | null;
  }>(
    `
      SELECT id::text, import_run_id::text
      FROM onec_import_jobs
      WHERE kind = $1
        AND status = 'running'
      FOR UPDATE
    `,
    [REGULAR_UPDATE_JOB_KIND],
  );

  for (const row of runningJobs.rows) {
    if (row.import_run_id) {
      await reconcileRunningRegularUpdateJob(client, row.id, row.import_run_id);
    }
  }
}
