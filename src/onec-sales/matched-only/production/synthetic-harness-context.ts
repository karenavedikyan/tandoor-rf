/** Non-portable local PG harness gate — never set from public production CLI. */
export function isSyntheticVerifiedHarnessActive(): boolean {
  return process.env.MATCHED_ONLY_SYNTHETIC_VERIFIED_HARNESS === "1";
}
