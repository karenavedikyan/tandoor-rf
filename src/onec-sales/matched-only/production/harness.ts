/**
 * Injectable preflight harness for isolated integration tests only.
 * Not used by the public production CLI.
 */
import type { ProductionPreflightOptions, ProductionPreflightResult } from "./preflight";
import { runProductionPreflight } from "./preflight";

export async function runProductionPreflightHarness(
  options: ProductionPreflightOptions & { targetFingerprintPolicy: string },
): Promise<ProductionPreflightResult> {
  return runProductionPreflight(options);
}
