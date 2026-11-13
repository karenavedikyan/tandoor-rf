import { closePool, getPool } from "../db/pool";
import { recoverVerifiedLegacyManualJob } from "../clients/admin-onec-update/job-lifecycle";

async function main(): Promise<void> {
  const argv = process.argv.slice(2), allowed = new Set([
    "--job-id", "--expected-started-at", "--confirm-worker-stopped", "--apply",
  ]);
  let jobId = "", expectedStartedAt = "", confirmedWorkerStopped = false, apply = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!allowed.has(flag)) throw new Error("UNKNOWN_ARGUMENT");
    if (flag === "--job-id") jobId = argv[++i] ?? "";
    if (flag === "--expected-started-at") expectedStartedAt = argv[++i] ?? "";
    if (flag === "--confirm-worker-stopped") confirmedWorkerStopped = true;
    if (flag === "--apply") apply = true;
  }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(jobId))
    throw new Error("JOB_ID_REQUIRED");
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_UNAVAILABLE");
  const db = await pool.connect();
  try {
    await db.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    await db.query("SET LOCAL statement_timeout=5000");
    if (apply) await recoverVerifiedLegacyManualJob(db, { jobId, expectedStartedAt, confirmedWorkerStopped });
    const row = (await db.query(`SELECT id,status,started_at,finished_at,error_code,
      (SELECT count(*) FROM onec_manual_batches b WHERE b.operator_job_id=j.id) AS saved_batches
      FROM onec_import_jobs j WHERE id=$1::uuid`, [jobId])).rows[0];
    await db.query("COMMIT");
    console.log(JSON.stringify({ mode: apply ? "apply" : "read_only", job: row ?? null }));
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { db.release(); }
}
main().catch(error => {
  // No driver messages, connection strings, business rows or environment values.
  const known = new Set(["UNKNOWN_ARGUMENT", "JOB_ID_REQUIRED", "DATABASE_UNAVAILABLE",
    "WORKER_STOP_CONFIRMATION_REQUIRED", "EXPECTED_STARTED_AT_REQUIRED", "JOB_NOT_RUNNING",
    "JOB_SCOPE_MISMATCH", "JOB_CHANGED", "LINKED_IMPORT_REQUIRES_REVIEW", "WORKER_ACTIVE"]);
  console.error(known.has(error?.message) ? error.message : "RECOVERY_FAILED");
  process.exitCode = 1;
}).finally(closePool);
