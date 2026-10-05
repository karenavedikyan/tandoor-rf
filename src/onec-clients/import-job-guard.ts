import type { PoolClient } from "pg";

export const IMPORT_JOB_SUPERSEDED_CODE = "IMPORT_JOB_SUPERSEDED" as const;

export async function assertOperatorImportJobRunnable(
  client: PoolClient,
  jobId: string,
): Promise<boolean> {
  const result = await client.query<{ status: string }>(
    `
      SELECT status
      FROM onec_import_jobs
      WHERE id = $1::uuid
    `,
    [jobId],
  );
  return result.rows[0]?.status === "running";
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
