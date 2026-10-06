export type RegularUpdateMode = "dry_run" | "apply";

export type RegularUpdateOutcomeStatus =
  | "SUCCESS"
  | "NO_CHANGES"
  | "REJECTED_BY_CHECKS"
  | "ERROR";

export type RegularUpdateResult = {
  status: RegularUpdateOutcomeStatus;
  mode: RegularUpdateMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  verificationFingerprint?: string;
  clientsSourceSha256?: string;
  employeeRosterSourceSha256?: string;
  exportBatchId?: string | null;
  /** Populated when 1C provides export timestamp metadata in a verified manifest; not inferred from download time. */
  sourceExportAt?: string | null;
  /** True only when export_bundle_manifest.json verifies batch ID and both file hashes. */
  releaseConsistencyConfirmed?: boolean;
  /** False until release consistency is confirmed by manifest; dry-run must not imply apply permission. */
  applyPermitted?: boolean;
  clientsReadCount?: number;
  rosterReadCount?: number;
  counts?: {
    clientsProcessed: number;
    outletsProcessed: number;
    employeesProcessed: number;
    clientsNew?: number;
    clientsChanged?: number;
    clientsUnchanged?: number;
    employeesNew?: number;
    employeesChanged?: number;
    employeesUnchanged?: number;
  };
  applyRunId?: string;
  errorCode?: string;
  message: string;
  cleanupWarning?: string;
};
