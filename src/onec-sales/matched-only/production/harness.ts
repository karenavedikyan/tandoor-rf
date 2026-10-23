/**
 * Injectable production harness for isolated integration tests only.
 * Not used by the public production CLI.
 */
import type { ProductionPreflightOptions, ProductionPreflightResult } from "./preflight";
import { runProductionPreflight } from "./preflight";
import {
  runProductionWriteApply,
  runProductionWriteRollback,
  type ProductionWriteResult,
  type ProductionExecutorHarnessOptions,
} from "./executor";

export async function runProductionPreflightHarness(
  options: ProductionPreflightOptions & { targetFingerprintPolicy: string },
): Promise<ProductionPreflightResult> {
  return runProductionPreflight(options);
}

export async function runProductionWriteApplyHarness(
  input: {
    manifest: ProductionPreflightOptions["manifest"];
    approvedExecutionHash: string;
    targetFingerprintPolicy: string;
  },
): Promise<ProductionWriteResult> {
  const harness: ProductionExecutorHarnessOptions = {
    targetFingerprintPolicy: input.targetFingerprintPolicy,
  };
  return runProductionWriteApply({
    manifest: input.manifest,
    approvedExecutionHash: input.approvedExecutionHash,
    ...harness,
  });
}

export async function runProductionWriteRollbackHarness(
  input: {
    manifest: ProductionPreflightOptions["manifest"];
    approvedExecutionHash: string;
    targetFingerprintPolicy: string;
  },
): Promise<ProductionWriteResult> {
  const harness: ProductionExecutorHarnessOptions = {
    targetFingerprintPolicy: input.targetFingerprintPolicy,
  };
  return runProductionWriteRollback({
    manifest: input.manifest,
    approvedExecutionHash: input.approvedExecutionHash,
    ...harness,
  });
}
