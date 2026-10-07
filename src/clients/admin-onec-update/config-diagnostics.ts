import { getImportJobWorkerTestHooks } from "../../onec-import/worker-scheduler";
import { runRegularUpdate, type RunRegularUpdateOptions } from "../../onec-regular-update/run-update";
import type { RegularUpdateResult } from "../../onec-regular-update/types";
import { finalizeRegularUpdateResult } from "../../onec-import/job-failure";
import { MANIFEST_UNAVAILABLE_USER_MESSAGE } from "../../onec-import/regular-update-job";
import {
  validateTrustedOnecFtpConfig,
  type TrustedConfigCheck,
  type TrustedConfigValidationResult,
} from "../../onec-import/trusted-config";

export type OnecConfigCheckResponse = {
  ok: boolean;
  checks: TrustedConfigCheck[];
  message: string;
  canProbe: boolean;
};

export type OnecUpdateProbeResponse = {
  /** Bundle is ready for apply (manifest confirmed, apply permitted). */
  ok: boolean;
  /** Files were read and validated structurally (dry-run reached SUCCESS/NO_CHANGES). */
  readOk: boolean;
  config: TrustedConfigValidationResult;
  probe: RegularUpdateResult | null;
  message: string;
};

function isRegularUpdateReadOk(result: RegularUpdateResult): boolean {
  return result.status === "SUCCESS" || result.status === "NO_CHANGES";
}

function isRegularUpdateBundleReady(result: RegularUpdateResult): boolean {
  return (
    isRegularUpdateReadOk(result) &&
    result.applyPermitted === true &&
    result.releaseConsistencyConfirmed === true
  );
}

function probeUserMessage(result: RegularUpdateResult): string {
  if (isRegularUpdateBundleReady(result)) {
    return result.message;
  }
  if (isRegularUpdateReadOk(result) && result.applyPermitted === false) {
    return MANIFEST_UNAVAILABLE_USER_MESSAGE;
  }
  return result.message;
}

export function runOnecIntegrationConfigCheck(
  env: NodeJS.ProcessEnv = process.env,
): OnecConfigCheckResponse {
  const validation = validateTrustedOnecFtpConfig(env);
  return {
    ok: validation.ok,
    checks: validation.checks,
    message: validation.message,
    canProbe: validation.ok,
  };
}

/**
 * Explicit read-only bundle/manifest probe. Never applies changes.
 */
export async function runOnecUpdateReadOnlyProbe(
  env: NodeJS.ProcessEnv = process.env,
  options: RunRegularUpdateOptions = {},
): Promise<OnecUpdateProbeResponse> {
  const config = validateTrustedOnecFtpConfig(env);
  if (!config.ok) {
    return {
      ok: false,
      readOk: false,
      config,
      probe: null,
      message: config.message,
    };
  }

  const testExecution = getImportJobWorkerTestHooks()?.regularUpdateExecution;
  const probe = finalizeRegularUpdateResult(
    await runRegularUpdate({
      ...testExecution,
      ...options,
      env: options.env ?? testExecution?.env ?? env,
      argv: ["--dry-run"],
    }),
    env,
  );

  const readOk = isRegularUpdateReadOk(probe);
  const ok = isRegularUpdateBundleReady(probe);

  return {
    ok,
    readOk,
    config,
    probe,
    message: probeUserMessage(probe),
  };
}
