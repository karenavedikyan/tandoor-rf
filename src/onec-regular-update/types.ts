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
  /** Populated when 1C provides export timestamp metadata; not inferred from download time. */
  sourceExportAt?: string | null;
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
