import { getImportJobWorkerTestHooks } from "../../onec-import/worker-scheduler";
import { runRegularUpdate, type RunRegularUpdateOptions } from "../../onec-regular-update/run-update";
import type { RegularUpdateResult } from "../../onec-regular-update/types";
import { redactRegularUpdateResult } from "../../onec-import/regular-update-job";
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
  ok: boolean;
  config: TrustedConfigValidationResult;
  probe: RegularUpdateResult | null;
  message: string;
};

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
      config,
      probe: null,
      message: config.message,
    };
  }

  const testExecution = getImportJobWorkerTestHooks()?.regularUpdateExecution;
  const probe = redactRegularUpdateResult(
    await runRegularUpdate({
      ...testExecution,
      ...options,
      env: options.env ?? testExecution?.env ?? env,
      argv: ["--dry-run"],
    }),
    env,
  );

  const probeOk = probe.status === "SUCCESS" || probe.status === "NO_CHANGES";

  return {
    ok: probeOk,
    config,
    probe,
    message: probe.message,
  };
}
