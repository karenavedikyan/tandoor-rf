import type { Pool } from "pg";
import { EMPLOYEES_RELATIVE_PATH, parseWholesaleEmployeeRosterBytes } from "../onec-clients/employee-roster";
import { prepareRegularUpdateWorkerQueue } from "../clients/admin-onec-update/nightly-job-lifecycle";
import {
  IMPORT_JOB_SUPERSEDED_CODE,
  markOperatorImportJobSuperseded,
  markOperatorImportJobWindowMissed,
} from "../onec-clients/import-job-guard";
import { isNightlyExchangeScheduleEnabled } from "../onec-nightly-exchange/config";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { defaultFtpReader, readRemoteFileFromFtp, type FtpReader } from "../onec-clients/ftp-read";
import { runClientsImport } from "../onec-clients/run-import";
import type { ClientsImportResult } from "../onec-clients/types";
import type { HoldingLinkValidationPolicy } from "../onec-clients/holding-link-policy";
import type { WholesaleCompositionMode } from "../onec-clients/wholesale-composition";
import type { RegularUpdateResult } from "../onec-regular-update/types";
import {
  IMPORT_JOB_KIND,
  REGULAR_UPDATE_JOB_KIND,
  REGULAR_UPDATE_JOB_SOURCE_NIGHTLY,
  type RegularUpdateJobSource,
} from "./constants";
import {
  buildImportJobFailure,
  finalizeRegularUpdateResult,
  ImportJobError,
  redactImportJobResult,
} from "./job-failure";
import { validateTrustedOnecFtpConfig } from "./trusted-config";
import {
  executeRegularUpdateBundleJob,
  redactRegularUpdateResult,
  type RegularUpdateJobExecutionOptions,
} from "./regular-update-job";

type ImportJobRow = {
  id: string;
  kind: typeof IMPORT_JOB_KIND | typeof REGULAR_UPDATE_JOB_KIND;
  mode: "dry_run" | "apply";
  expected_sha256: string | null;
  holding_link_validation_policy: HoldingLinkValidationPolicy;
  employee_roster_source_sha256: string | null;
  wholesale_composition_mode: WholesaleCompositionMode;
  job_source: RegularUpdateJobSource;
  nightly_window_deadline_at: Date | null;
};

function importTriggerSourceForJob(
  jobSource: RegularUpdateJobSource,
): "regular_update" | "regular_update_nightly" {
  return jobSource === REGULAR_UPDATE_JOB_SOURCE_NIGHTLY ? "regular_update_nightly" : "regular_update";
}

export type ImportJobWorkerTestHooks = {
  regularUpdateExecution?: RegularUpdateJobExecutionOptions;
};

export type ImportJobWorkerOptions = {
  kinds?: readonly (typeof IMPORT_JOB_KIND | typeof REGULAR_UPDATE_JOB_KIND)[];
};

function buildImportArgv(job: ImportJobRow): string[] {
  const argv: string[] =
    job.mode === "dry_run" ? ["--dry-run"] : ["--apply", "--expected-sha256", job.expected_sha256!];
  if (job.holding_link_validation_policy !== "tolerant") {
    argv.push("--holding-link-policy", job.holding_link_validation_policy);
  }
  if (job.wholesale_composition_mode === "replacement_prep") {
    argv.push("--wholesale-composition-prep");
  }
  return argv;
}

async function readEmployeeRosterFromFtp(env: NodeJS.ProcessEnv): Promise<Buffer | undefined> {
  const config = loadOnecFtpConfig(env);
  if (!config.ok) {
    return undefined;
  }
  const rosterPath = `${config.config.basePath.replace(/\/+$/, "")}/${EMPLOYEES_RELATIVE_PATH}`;
  const result = await readRemoteFileFromFtp(config.config, rosterPath, 32 * 1024 * 1024);
  if (!result.ok) {
    return undefined;
  }
  return result.bytes;
}

function extractImportRunId(result: ClientsImportResult): string | null {
  return result.apply?.runId ?? null;
}

function extractRegularUpdateRunId(result: RegularUpdateResult): string | null {
  return result.applyRunId ?? null;
}

function regularUpdateJobSucceeded(result: RegularUpdateResult): boolean {
  return result.status === "SUCCESS" || result.status === "NO_CHANGES";
}

function serializeJobResult(result: unknown, env: NodeJS.ProcessEnv): string {
  return JSON.stringify(redactImportJobResult(result, env));
}

async function runLegacyClientsSnapshotJob(
  job: ImportJobRow,
  env: NodeJS.ProcessEnv,
  reader: FtpReader,
): Promise<{ ok: boolean; result: ClientsImportResult; importRunId: string | null; errorCode: string }> {
  let employeeRosterBytes: Buffer | undefined;
  if (job.employee_roster_source_sha256) {
    employeeRosterBytes = await readEmployeeRosterFromFtp(env);
    if (!employeeRosterBytes) {
      throw new ImportJobError(
        "EMPLOYEE_ROSTER_UNREADABLE",
        "employee_roster",
        "Не удалось прочитать справочник сотрудников из 1С.",
      );
    }
    const parsed = parseWholesaleEmployeeRosterBytes(employeeRosterBytes);
    if (!parsed.ok || parsed.roster.sourceSha256 !== job.employee_roster_source_sha256) {
      throw new ImportJobError(
        "EMPLOYEE_ROSTER_MISMATCH",
        "employee_roster",
        "Справочник сотрудников не совпадает с ожидаемым снимком.",
      );
    }
  }

  const importResult = await runClientsImport({
    env,
    argv: buildImportArgv(job),
    ftpReader: reader,
    triggerSource: "operator_job",
    employeeRosterBytes,
    operatorImportJobId: job.id,
    validationLimits: {
      holdingLinkValidationPolicy: job.holding_link_validation_policy,
      wholesaleCompositionMode: job.wholesale_composition_mode,
      employeeRosterExplicit: job.employee_roster_source_sha256 != null,
    },
  });

  if (importResult.status === "SUCCESS") {
    return {
      ok: true,
      result: importResult,
      importRunId: extractImportRunId(importResult),
      errorCode: importResult.status,
    };
  }

  if (importResult.errorCode === IMPORT_JOB_SUPERSEDED_CODE) {
    return {
      ok: false,
      result: importResult,
      importRunId: extractImportRunId(importResult),
      errorCode: IMPORT_JOB_SUPERSEDED_CODE,
    };
  }

  return {
    ok: false,
    result: importResult,
    importRunId: extractImportRunId(importResult),
    errorCode: importResult.errorCode ?? importResult.status,
  };
}

async function runRegularUpdateBundleJob(
  job: ImportJobRow,
  env: NodeJS.ProcessEnv,
  testHooks?: ImportJobWorkerTestHooks,
): Promise<{ ok: boolean; result: RegularUpdateResult; importRunId: string | null; errorCode: string }> {
  const updateResult = await executeRegularUpdateBundleJob({
    env,
    operatorImportJobId: job.id,
    importTriggerSource: importTriggerSourceForJob(job.job_source),
    ...testHooks?.regularUpdateExecution,
  });
  const redacted = finalizeRegularUpdateResult(updateResult, env);
  return {
    ok: regularUpdateJobSucceeded(redacted),
    result: redacted,
    importRunId: extractRegularUpdateRunId(redacted),
    errorCode: redacted.errorCode ?? redacted.status,
  };
}

/**
 * One attempt per invocation, no timer and no HTTP entry point.
 * Only an unexpired operator-created job can authorize FTP read / apply.
 * Operator job validity is re-checked inside applyClientsImport after the shared import lock is held.
 */
export async function runOneImportJob(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
  reader: FtpReader = defaultFtpReader,
  testHooks?: ImportJobWorkerTestHooks,
  workerOptions?: ImportJobWorkerOptions,
): Promise<"idle" | "success" | "failed"> {
  const kinds = workerOptions?.kinds ?? [IMPORT_JOB_KIND, REGULAR_UPDATE_JOB_KIND];
  const db = await pool.connect();
  let jobId: string | undefined;
  try {
    await db.query("BEGIN");
    await prepareRegularUpdateWorkerQueue(db, {
      nightlyScheduleEnabled: isNightlyExchangeScheduleEnabled(env),
    });
    await db.query("COMMIT");

    const claimed = await db.query<ImportJobRow>(
      `
      UPDATE onec_import_jobs
      SET status = 'running', started_at = NOW()
      WHERE id = (
        SELECT id
        FROM onec_import_jobs
        WHERE kind = ANY($1::text[])
          AND status = 'pending'
          AND expires_at > NOW()
          AND (
            job_source <> 'nightly'
            OR (
              nightly_window_deadline_at IS NOT NULL
              AND nightly_window_deadline_at > NOW()
            )
          )
        ORDER BY requested_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        kind,
        mode,
        expected_sha256,
        holding_link_validation_policy,
        employee_roster_source_sha256,
        wholesale_composition_mode,
        job_source,
        nightly_window_deadline_at
    `,
      [kinds],
    );
    const job = claimed.rows[0];
    jobId = job?.id;
    if (!job) {
      return "idle";
    }

    if (
      job.job_source === REGULAR_UPDATE_JOB_SOURCE_NIGHTLY &&
      job.nightly_window_deadline_at &&
      job.nightly_window_deadline_at <= new Date()
    ) {
      await markOperatorImportJobWindowMissed(db, job.id);
      return "failed";
    }

    const trustedConfig = validateTrustedOnecFtpConfig(env);
    if (!trustedConfig.ok) {
      throw new ImportJobError("CONFIG_INVALID", "config", trustedConfig.message);
    }

    const outcome =
      job.kind === REGULAR_UPDATE_JOB_KIND
        ? await runRegularUpdateBundleJob(job, env, testHooks)
        : await runLegacyClientsSnapshotJob(job, env, reader);

    const redacted = serializeJobResult(outcome.result, env);

    if (outcome.ok) {
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
        [job.id, redacted, outcome.importRunId],
      );
      console.info(
        JSON.stringify({
          event: "onec_import_job_finished",
          jobId: job.id,
          kind: job.kind,
          status: "success",
          importRunId: outcome.importRunId,
        }),
      );
      return "success";
    }

    if (outcome.errorCode === IMPORT_JOB_SUPERSEDED_CODE) {
      await markOperatorImportJobSuperseded(db, job.id);
      return "failed";
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
      [job.id, redacted, outcome.errorCode, outcome.importRunId],
    );
    console.info(
      JSON.stringify({
        event: "onec_import_job_finished",
        jobId: job.id,
        kind: job.kind,
        status: "failed",
        errorCode: outcome.errorCode,
        stage: (outcome.result as { stage?: string }).stage ?? null,
        importRunId: outcome.importRunId,
      }),
    );
    return "failed";
  } catch (error) {
    if (jobId) {
      const failedJob = (
        await db.query<{ mode: "dry_run" | "apply" }>(
          `SELECT mode FROM onec_import_jobs WHERE id = $1::uuid`,
          [jobId],
        )
      ).rows[0];
      const failure = buildImportJobFailure(error, failedJob?.mode ?? "dry_run", env);
      const redacted = serializeJobResult(failure.result, env);
      await db.query(
        `
          UPDATE onec_import_jobs
          SET
            status = 'failed',
            finished_at = NOW(),
            error_code = $2,
            result = $3::jsonb
          WHERE id = $1::uuid AND status = 'running'
        `,
        [jobId, failure.errorCode, redacted],
      );
      console.info(
        JSON.stringify({
          event: "onec_import_job_finished",
          jobId,
          status: "failed",
          errorCode: failure.errorCode,
          stage: failure.stage,
          diagnosticId: failure.diagnosticId,
          message: failure.message,
        }),
      );
    }
    return "failed";
  } finally {
    db.release();
  }
}
