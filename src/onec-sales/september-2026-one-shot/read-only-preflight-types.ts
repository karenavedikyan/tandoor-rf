export type ReadOnlyPreflightTestContext = {
  /** Local integration DB only — never accepted from operator bundle env. */
  allowNonProductionDatabaseUrl?: boolean;
  skipTargetFingerprintPin?: boolean;
  skipCatalogPin?: boolean;
  /** Local harness only — skips FTP pin verification and financial rollup. */
  skipSourcePinChecks?: boolean;
  /** Apply/write path: nightly scheduler env may be enabled in dev integration hosts. */
  skipNightlySchedulerPin?: boolean;
};
