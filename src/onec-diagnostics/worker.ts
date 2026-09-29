import type { Pool } from "pg";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { defaultFtpReader, type FtpReader } from "../onec-clients/ftp-read";
import { buildIdentitySnapshot } from "./snapshot";

const LOCK = 902_451_003;

/**
 * One attempt at server startup, no timer and no HTTP entry point.
 * Only an unexpired operator-created job can authorize a read.
 * A crash leaves a running job for operator review, never an automatic retry.
 */
export async function runOneDiagnosticJob(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
  reader: FtpReader = defaultFtpReader,
): Promise<"idle" | "success" | "failed"> {
  const db = await pool.connect();
  let locked = false;
  let jobId: string | undefined;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK])).rows[0].locked === true;
    if (!locked) return "idle";
    const claimed = await db.query<{ id: string }>(`
      UPDATE onec_diagnostic_jobs SET status='running', started_at=NOW()
      WHERE id=(SELECT id FROM onec_diagnostic_jobs
        WHERE kind='client_identity_snapshot' AND status='pending' AND expires_at>NOW()
        ORDER BY requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    jobId = claimed.rows[0]?.id;
    if (!jobId) return "idle";
    const config = loadOnecFtpConfig(env);
    if (!config.ok || config.config.host !== "gw.toopatch.ru" ||
        config.config.basePath.replace(/\/+$/, "") !== "/LC" || config.config.security !== "plain") {
      throw new Error("CONFIG_INVALID");
    }
    const source = await reader(config.config);
    if (!source.ok) throw new Error("FTP_READ_FAILED");
    const report = buildIdentitySnapshot(source.bytes);
    // Defense in depth if an upstream label unexpectedly contains the FTP secret.
    const escapedSecret = JSON.stringify(config.config.password).slice(1, -1);
    const serialized = JSON.stringify(report).split(escapedSecret).join("[REDACTED]");
    await db.query(`UPDATE onec_diagnostic_jobs
      SET status='success',finished_at=NOW(),report=$2::jsonb,error_code=NULL
      WHERE id=$1 AND status='running'`, [jobId, serialized]);
    return "success";
  } catch {
    if (jobId) {
      await db.query(`UPDATE onec_diagnostic_jobs SET status='failed',finished_at=NOW(),
        error_code='DIAGNOSTIC_FAILED',report=NULL WHERE id=$1 AND status='running'`, [jobId]);
    }
    return "failed";
  } finally {
    // Never put a connection holding a session-level advisory lock back in the pool.
    let releaseError: Error | undefined;
    if (locked) {
      try { await db.query("SELECT pg_advisory_unlock($1)", [LOCK]); }
      catch { releaseError = new Error("DIAGNOSTIC_LOCK_RELEASE_FAILED"); }
    }
    db.release(releaseError);
  }
}
