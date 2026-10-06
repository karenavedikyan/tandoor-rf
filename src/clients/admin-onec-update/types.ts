export type OnecUpdateUiPhase =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "no_changes"
  | "rejected"
  | "error";

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
