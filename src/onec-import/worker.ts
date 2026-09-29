import type { Pool } from "pg";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { defaultFtpReader, type FtpReader } from "../onec-clients/ftp-read";
import { runClientsImport } from "../onec-clients/run-import";
import type { ClientsImportResult } from "../onec-clients/types";
import {
  IMPORT_JOB_KIND,
  TRUSTED_ONEC_FTP_BASE_PATH,
  TRUSTED_ONEC_FTP_HOST,
} from "./constants";

type ImportJobRow = {
  id: string;
  mode: "dry_run" | "apply";
  expected_sha256: string | null;
};

function isTrustedFtpConfig(env: NodeJS.ProcessEnv): boolean {
  const config = loadOnecFtpConfig(env);
  if (!config.ok) {
    return false;
  }
  return (
    config.config.host === TRUSTED_ONEC_FTP_HOST &&
    config.config.basePath.replace(/\/+$/, "") === TRUSTED_ONEC_FTP_BASE_PATH &&
    config.config.security === "plain"
  );
}

function buildImportArgv(job: ImportJobRow): string[] {
  if (job.mode === "dry_run") {
    return ["--dry-run"];
  }
  return ["--apply", "--expected-sha256", job.expected_sha256!];
}

function extractImportRunId(result: ClientsImportResult): string | null {
  return result.apply?.runId ?? null;
}

/**
 * One attempt per invocation, no timer and no HTTP entry point.
 * Only an unexpired operator-created job can authorize FTP read / apply.
 * Import mutual exclusion uses the shared clients import advisory lock inside apply.
 */
export async function runOneImportJob(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
  reader: FtpReader = defaultFtpReader,
): Promise<"idle" | "success" | "failed"> {
  const db = await pool.connect();
  let jobId: string | undefined;
  try {
    const claimed = await db.query<ImportJobRow>(`
      UPDATE onec_import_jobs
      SET status = 'running', started_at = NOW()
      WHERE id = (
        SELECT id
        FROM onec_import_jobs
        WHERE kind = $1
          AND status = 'pending'
          AND expires_at > NOW()
        ORDER BY requested_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, mode, expected_sha256
    `, [IMPORT_JOB_KIND]);
    const job = claimed.rows[0];
    jobId = job?.id;
    if (!job) {
      return "idle";
    }

    if (!isTrustedFtpConfig(env)) {
      throw new Error("CONFIG_INVALID");
    }

    const importResult = await runClientsImport({
      env,
      argv: buildImportArgv(job),
      ftpReader: reader,
      triggerSource: "operator_job",
    });
    const serialized = JSON.stringify(importResult);
    const config = loadOnecFtpConfig(env);
    const secret = config.ok ? config.config.password : "";
    const redacted = secret ? serialized.split(secret).join("[REDACTED]") : serialized;

    if (importResult.status === "SUCCESS") {
      await db.query(
        `
          UPDATE onec_import_jobs
          SET
            status = 'success',
            finished_at = NOW(),
            result = $2::jsonb,
            error_code = NULL,
            import_run_id = $3::uuid
          WHERE id = $1::uuid AND status = 'running'
        `,
        [job.id, redacted, extractImportRunId(importResult)],
      );
      return "success";
    }

    await db.query(
      `
        UPDATE onec_import_jobs
        SET
          status = 'failed',
          finished_at = NOW(),
          result = $2::jsonb,
          error_code = $3,
          import_run_id = $4::uuid
        WHERE id = $1::uuid AND status = 'running'
      `,
      [
        job.id,
        redacted,
        importResult.errorCode ?? importResult.status,
        extractImportRunId(importResult),
      ],
    );
    return "failed";
  } catch {
    if (jobId) {
      await db.query(
        `
          UPDATE onec_import_jobs
          SET status = 'failed', finished_at = NOW(), error_code = 'IMPORT_JOB_FAILED', result = NULL
          WHERE id = $1::uuid AND status = 'running'
        `,
        [jobId],
      );
    }
    return "failed";
  } finally {
    db.release();
  }
}
