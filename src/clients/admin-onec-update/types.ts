export type OnecUpdateUiPhase =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "no_changes"
  | "rejected"
  | "error"
  | "uncertain";

export type RegularUpdateJobSourceDto = "admin_manual" | "nightly";

export type AdminOnecUpdateJobDto = {
  id: string;
  phase: OnecUpdateUiPhase;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  sourceExportAt: string | null;
  sourceExportAtLabel: string | null;
  lastSuccessfulUpdateAt: string | null;
  lastSuccessfulUpdateAtLabel: string | null;
  dataPreserved: boolean;
  errorCode: string | null;
  requestedByUserId: string | null;
  jobSource: RegularUpdateJobSourceDto;
  jobSourceLabel: string;
  exportBatchId: string | null;
  failureStage: string | null;
  diagnosticId: string | null;
};

export type AdminOnecUpdateStatusResponse = {
  job: AdminOnecUpdateJobDto | null;
  canStart: boolean;
  blockedReason: string | null;
};

export type AdminOnecUpdateStartResponse = {
  jobId: string;
  phase: "pending";
  message: string;
};

export type AdminOnecConfigCheckResponse = {
  ok: boolean;
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  message: string;
  canProbe: boolean;
};

export type AdminOnecUpdateProbeResponse = {
  ok: boolean;
  readOk: boolean;
  message: string;
  config: AdminOnecConfigCheckResponse;
  probe: {
    status: string;
    errorCode?: string;
    stage?: string;
    message: string;
    applyPermitted?: boolean;
    releaseConsistencyConfirmed?: boolean;
  } | null;
};
