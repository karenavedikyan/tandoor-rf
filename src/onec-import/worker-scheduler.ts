import { getPool } from "../db/pool";
import { defaultFtpReader } from "../onec-clients/ftp-read";
import { runOneImportJob, type ImportJobWorkerTestHooks } from "./worker";

let testHooks: ImportJobWorkerTestHooks | undefined;
let kickInFlight: Promise<"idle" | "success" | "failed"> | null = null;

/** Test-only hook injection for integration scenarios without manual CLI. */
export function setImportJobWorkerTestHooks(hooks: ImportJobWorkerTestHooks | undefined): void {
  testHooks = hooks;
}

export function getImportJobWorkerTestHooks(): ImportJobWorkerTestHooks | undefined {
  return testHooks;
}

/**
 * Process at most one pending import job. Safe to call after admin POST or on startup.
 * Does not start a periodic scheduler — only explicit kicks.
 */
export function kickImportJobWorker(): void {
  const pool = getPool();
  if (!pool) {
    return;
  }
  if (kickInFlight) {
    return;
  }
  kickInFlight = runOneImportJob(pool, process.env, defaultFtpReader, testHooks)
    .catch((error) => {
      console.error(
        JSON.stringify({
          event: "onec_import_job_worker_kick_failed",
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
      return "failed" as const;
    })
    .finally(() => {
      kickInFlight = null;
    });
}

/** Drain a small backlog on startup (admin button jobs, not nightly exchange). */
export async function drainPendingImportJobs(maxAttempts = 5): Promise<void> {
  const pool = getPool();
  if (!pool) {
    return;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await runOneImportJob(pool, process.env, defaultFtpReader, testHooks);
    if (status === "idle") {
      return;
    }
  }
}
