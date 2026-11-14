import type { PoolClient } from "pg";
import { REGULAR_UPDATE_JOB_KIND } from "../../onec-import/constants";
import { finalizeExpiredNightlyWindowJobs } from "./nightly-job-lifecycle";
import { acquireRecoveryLease } from "../../onec-import/worker-lease";
import { IMPORT_ADVISORY_LOCK_KEY } from "../../onec-clients/constants";

export const JOB_EXPIRED_CODE = "JOB_EXPIRED";
export const WORKER_INTERRUPTED_CODE = "WORKER_INTERRUPTED";

/** Only versioned atomic manual attempts are eligible. Never clear an unrelated block. */
async function reconcileUncertainManualCommits(client: PoolClient): Promise<void> {
  const candidates = await client.query<{ id: string; status: string }>(`
    SELECT id::text,status FROM onec_import_jobs
    WHERE kind='regular_update_bundle' AND job_source='admin_manual' AND (
      (error_code='COMMIT_UNCERTAIN' AND result->>'manualRecoveryVersion'='1')
      OR id::text=(SELECT substring(apply_blocked_reason FROM 25)
        FROM onec_v3_exchange_state WHERE id=1 AND apply_blocked_reason LIKE 'MANUAL_COMMIT_UNCERTAIN:%')
    ) FOR UPDATE SKIP LOCKED`);
  for (const row of candidates.rows) {
    if (!(await acquireRecoveryLease(client, row.id))) continue;
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS locked", [IMPORT_ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.locked) continue;
    // Both the worker lease and apply transaction have ended. A committed attempt
    // is already success because finishOperatorJob is in the same transaction.
    if (row.status === "pending") continue;
    if (row.status !== "success") await recoverInterruptedManualJob(client, row.id, true);
    await client.query(`UPDATE onec_v3_exchange_state SET apply_blocked=FALSE,
      apply_blocked_reason=NULL,updated_at=NOW() WHERE id=1
      AND apply_blocked_reason=$1`, [`MANUAL_COMMIT_UNCERTAIN:${row.id}`]);
  }
}

/** Caller holds the job row lock. Only versioned leases may be recovered automatically. */
async function recoverInterruptedManualJob(client: PoolClient, jobId: string, uncertain = false): Promise<void> {
  // Versioned uncertain attempts have an atomic per-attempt result in the job
  // itself. A batch's original operator_job_id is NOT a receipt for A→B→A.
  if (uncertain) {
    await client.query(`UPDATE onec_import_jobs SET status='failed',finished_at=NOW(),error_code=$2,
      result=jsonb_build_object('status','ERROR','mode','apply','manualRecoveryVersion',1,
        'errorCode',$2::text,'message','Обновление прервано. Сохранение не выполнено. Прежние данные сохранены. Можно повторить обновление.')
      WHERE id=$1::uuid AND status IN ('running','failed')`, [jobId, WORKER_INTERRUPTED_CODE]);
    return;
  }
  const batch = (await client.query<{
    id: string; fingerprint: string; counts: Record<string, number>; issue_count: number; imported_at: Date;
  }>(`SELECT id::text,fingerprint,counts,issue_count,imported_at FROM onec_manual_batches
      WHERE operator_job_id=$1::uuid ORDER BY imported_at DESC LIMIT 1`, [jobId])).rows[0];
  if (batch) {
    // COMMIT may have succeeded just before the worker died. Never report rollback
    // or repeat the import when the atomic batch journal proves completion.
    await client.query(`UPDATE onec_import_jobs SET status='success',finished_at=$2,error_code=NULL,
      result=jsonb_build_object('status','SUCCESS','mode','apply','exportBatchId',$3::text,
        'verificationFingerprint',$4::text,'manualSummary',
        jsonb_build_object('batchId',$3::text,'files',$5::jsonb,'issueCount',$6::integer),
        'message','Обновление сохранено. Итог задания восстановлен после остановки процесса.')
      WHERE id=$1::uuid AND status='running'`,
    [jobId, batch.imported_at, batch.id, batch.fingerprint, JSON.stringify(batch.counts), batch.issue_count]);
  } else {
    await client.query(`UPDATE onec_import_jobs SET status='failed',finished_at=NOW(),error_code=$2,
      result=jsonb_build_object('status','ERROR','mode','apply','errorCode',$2::text,
        'message','Выполнение прервано: процесс обновления остановился. Новый пакет не сохранён. Автоматический повтор не запускается.')
      WHERE id=$1::uuid AND status='running'`, [jobId, WORKER_INTERRUPTED_CODE]);
  }
}

/** Explicit maintenance only, never called by HTTP/startup. Caller owns transaction.
 * Legacy workers have no lease: an operator must independently prove the original
 * process stopped (including other replicas), not merely that no DB lock exists.
 */
export async function recoverVerifiedLegacyManualJob(client: PoolClient, input: {
  jobId: string; expectedStartedAt: string; confirmedWorkerStopped: boolean;
}): Promise<void> {
  if (!input.confirmedWorkerStopped) throw new Error("WORKER_STOP_CONFIRMATION_REQUIRED");
  const expected = Date.parse(input.expectedStartedAt);
  if (!Number.isFinite(expected)) throw new Error("EXPECTED_STARTED_AT_REQUIRED");
  const row = (await client.query<{
    status: string; kind: string; job_source: string; started_at: Date | null; import_run_id: string | null;
  }>(`SELECT status,kind,job_source,started_at,import_run_id FROM onec_import_jobs
      WHERE id=$1::uuid FOR UPDATE NOWAIT`, [input.jobId])).rows[0];
  if (!row || row.status !== "running") throw new Error("JOB_NOT_RUNNING");
  if (row.kind !== REGULAR_UPDATE_JOB_KIND || row.job_source !== "admin_manual")
    throw new Error("JOB_SCOPE_MISMATCH");
  if (row.started_at?.getTime() !== expected) throw new Error("JOB_CHANGED");
  if (row.import_run_id) throw new Error("LINKED_IMPORT_REQUIRES_REVIEW");
  const available = (await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock($1) AS locked", [IMPORT_ADVISORY_LOCK_KEY],
  )).rows[0]?.locked;
  if (!available || !(await acquireRecoveryLease(client, input.jobId))) throw new Error("WORKER_ACTIVE");
  await recoverInterruptedManualJob(client, input.jobId);
}

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
  await reconcileUncertainManualCommits(client);
  await finalizeExpiredNightlyWindowJobs(client);
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
    worker_lease_version: number | null;
    job_source: string;
  }>(
    `
      SELECT id::text, import_run_id::text,
        CASE WHEN result->>'workerLeaseVersion'='1' THEN 1 END AS worker_lease_version, job_source
      FROM onec_import_jobs
      WHERE kind = $1
        AND status = 'running'
      -- An active importer holds this row until COMMIT. Status must remain readable;
      -- defer reconciliation of locked jobs instead of waiting for the import.
      FOR UPDATE SKIP LOCKED
    `,
    [REGULAR_UPDATE_JOB_KIND],
  );

  for (const row of runningJobs.rows) {
    if (row.import_run_id) {
      await reconcileRunningRegularUpdateJob(client, row.id, row.import_run_id);
    } else if (row.worker_lease_version === 1 && row.job_source === "admin_manual") {
      if (!(await acquireRecoveryLease(client, row.id))) continue;
      await recoverInterruptedManualJob(client, row.id);
    }
  }
}
