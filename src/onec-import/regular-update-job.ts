import { finalizeRegularUpdateResult } from "./job-failure";
import { runRegularUpdate, type RunRegularUpdateOptions } from "../onec-regular-update/run-update";
import type { RegularUpdateResult } from "../onec-regular-update/types";

export const DATA_PRESERVED_SUFFIX =
  " Прежние данные клиентов и назначений сохранены без изменений.";

export type RegularUpdateJobExecutionOptions = RunRegularUpdateOptions;

function shouldAppendDataPreserved(result: RegularUpdateResult): boolean {
  if (result.errorCode === "COMMIT_UNCERTAIN") {
    return false;
  }
  return (
    result.status === "REJECTED_BY_CHECKS" ||
    (result.status === "ERROR" &&
      result.errorCode !== "IMPORT_JOB_FAILED" &&
      result.errorCode !== "DATABASE_ERROR")
  );
}

function withDataPreservedMessage(result: RegularUpdateResult): RegularUpdateResult {
  if (!shouldAppendDataPreserved(result)) {
    return result;
  }
  if (result.message.includes("Прежние данные")) {
    return result;
  }
  return { ...result, message: result.message + DATA_PRESERVED_SUFFIX };
}

/** Verify bundle, obtain fingerprint, then apply — single worker attempt. */
export async function executeRegularUpdateBundleJob(
  options: RegularUpdateJobExecutionOptions = {},
): Promise<RegularUpdateResult> {
  const env = options.env ?? process.env;
  const dryRun = await runRegularUpdate({
    ...options,
    env,
    argv: ["--dry-run"],
  });

  if (dryRun.status === "REJECTED_BY_CHECKS" || dryRun.status === "ERROR") {
    return withDataPreservedMessage(
      finalizeRegularUpdateResult({ ...dryRun, mode: "apply" }, env),
    );
  }

  if (dryRun.status !== "SUCCESS" || dryRun.mode !== "dry_run") {
    return withDataPreservedMessage(
      finalizeRegularUpdateResult(
        {
          ...dryRun,
          status: "ERROR",
          mode: "apply",
          errorCode: dryRun.errorCode ?? "IMPORT_JOB_FAILED",
          message: dryRun.message || "Не удалось проверить комплект перед обновлением.",
        },
        env,
      ),
    );
  }

  if (!dryRun.applyPermitted) {
    return withDataPreservedMessage(
      finalizeRegularUpdateResult(
        {
          ...dryRun,
          status: "REJECTED_BY_CHECKS",
          mode: "apply",
          errorCode: dryRun.errorCode ?? "VALIDATION_FAILED",
          message: dryRun.message || "Комплект не прошёл проверку перед обновлением.",
        },
        env,
      ),
    );
  }

  if (!dryRun.verificationFingerprint) {
    return withDataPreservedMessage(
      finalizeRegularUpdateResult(
        {
          ...dryRun,
          status: "ERROR",
          mode: "apply",
          errorCode: "VERIFICATION_FINGERPRINT_REQUIRED",
          message: "Не удалось получить отпечаток проверки комплекта." + DATA_PRESERVED_SUFFIX,
        },
        env,
      ),
    );
  }

  const applied = await runRegularUpdate({
    ...options,
    env,
    argv: ["--apply", "--expected-fingerprint", dryRun.verificationFingerprint],
  });

  return withDataPreservedMessage(
    finalizeRegularUpdateResult({ ...applied, mode: "apply" }, env),
  );
}

export function redactRegularUpdateResult(
  result: RegularUpdateResult,
  env: NodeJS.ProcessEnv = process.env,
): RegularUpdateResult {
  return finalizeRegularUpdateResult(result, env);
}
