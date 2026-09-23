export const ONEC_FTP_PROBE_STATUSES = [
  "DISABLED",
  "SUCCESS",
  "CONFIG_ERROR",
  "TLS_UNAVAILABLE",
  "NETWORK_ERROR",
  "TLS_ERROR",
  "AUTH_FAILED",
  "PATH_ACCESS_DENIED",
  "LIST_FAILED",
  "TIMEOUT",
  "OUTPUT_LIMIT_EXCEEDED",
] as const;

export type OnecFtpProbeStatus = (typeof ONEC_FTP_PROBE_STATUSES)[number];

export const ONEC_FTP_PROBE_STAGES = [
  "config",
  "connect",
  "tls_negotiation",
  "authentication",
  "base_path_access",
  "list_transfer",
  "complete",
] as const;

export type OnecFtpProbeStage = (typeof ONEC_FTP_PROBE_STAGES)[number];

export type OnecFtpFileEntry = {
  name: string;
  type: "file" | "directory" | "other";
  size: number | null;
  modifiedAt: string | null;
};

export type OnecFtpConfig = {
  enabled: true;
  host: string;
  port: number;
  user: string;
  password: string;
  basePath: string;
  timeoutMs: number;
};

export type OnecFtpProbeResult = {
  status: OnecFtpProbeStatus;
  stage: OnecFtpProbeStage;
  durationMs: number;
  ftpCode?: number;
  message: string;
  basePath?: string;
  files?: OnecFtpFileEntry[];
  fileCount?: number;
  truncated?: boolean;
};
