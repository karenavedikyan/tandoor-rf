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
  /** True when both files were read stably and passed bundle validation; does not imply release consistency. */
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
  /** Worker/admin diagnostics: where the failure occurred without exposing secrets. */
  stage?: import("../onec-import/job-failure").ImportJobFailureStage;
  /** Opaque id for unknown internal failures; safe to show admins. */
  diagnosticId?: string;
  message: string;
  cleanupWarning?: string;
};
