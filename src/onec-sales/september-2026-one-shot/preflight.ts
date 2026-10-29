import type { ReadOnlyPreflightTestContext } from "./read-only-preflight-types";
import { runSeptember2026ReadOnlyPreflight, type SeptemberReadOnlyPreflightReport } from "./read-only-preflight-core";
import type { SeptemberSourceBuffers } from "./source-pins";

export type SeptemberPreflightReport = SeptemberReadOnlyPreflightReport;

/** @deprecated Use runSeptember2026ReadOnlyPreflight with explicit sources and testContext. */
export async function runSeptember2026Preflight(input: {
  databaseUrl: string;
  sources: SeptemberSourceBuffers;
  testContext?: ReadOnlyPreflightTestContext;
}): Promise<
  | { ok: true; report: SeptemberPreflightReport }
  | { ok: false; code: string; message: string; report?: SeptemberPreflightReport }
> {
  return runSeptember2026ReadOnlyPreflight(input);
}
