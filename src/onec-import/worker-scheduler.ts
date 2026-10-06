import { getPool } from "../db/pool";
import { defaultFtpReader } from "../onec-clients/ftp-read";
import { REGULAR_UPDATE_JOB_KIND } from "./constants";
import { runOneImportJob, type ImportJobWorkerTestHooks } from "./worker";

let testHooks: ImportJobWorkerTestHooks | undefined;
let kickInFlight: Promise<"idle" | "success" | "failed"> | null = null;

const ADMIN_AUTO_WORKER_KINDS = [REGULAR_UPDATE_JOB_KIND] as const;

/** Test-only hook injection for integration scenarios without manual CLI. */
export function setImportJobWorkerTestHooks(hooks: ImportJobWorkerTestHooks | undefined): void {
  testHooks = hooks;
}

export function getImportJobWorkerTestHooks(): ImportJobWorkerTestHooks | undefined {
  return testHooks;
}

/**
 * Process at most one pending admin regular-update job. Safe to call after admin POST or on startup.
 * Does not start a periodic scheduler and does not claim legacy clients_snapshot jobs.
 */
export function kickImportJobWorker(): void {
  const pool = getPool();
  if (!pool) {
    return;
  }
  if (kickInFlight) {
    return;
  }
  kickInFlight = runOneImportJob(pool, process.env, defaultFtpReader, testHooks, {
    kinds: ADMIN_AUTO_WORKER_KINDS,
  })
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

/** Drain admin regular-update backlog on startup (not legacy operator snapshot jobs). */
export async function drainPendingImportJobs(maxAttempts = 5): Promise<void> {
  const pool = getPool();
  if (!pool) {
    return;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await runOneImportJob(pool, process.env, defaultFtpReader, testHooks, {
      kinds: ADMIN_AUTO_WORKER_KINDS,
    });
    if (status === "idle") {
      return;
    }
  }
}
