export const MAX_API_ALLOWED_METHODS = ["me", "subscriptions"] as const;

export type MaxApiReadMethod = (typeof MAX_API_ALLOWED_METHODS)[number];

export type MaxTransportErrorCode =
  | "NETWORK_ERROR"
  | "TLS_ERROR"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "HTTP_ERROR"
  | "API_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "METHOD_NOT_ALLOWED";

export type MaxTransportFailure = {
  ok: false;
  code: MaxTransportErrorCode;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
};

export type MaxTransportSuccess = { ok: true; result: unknown };

export type MaxTransportResult = MaxTransportSuccess | MaxTransportFailure;

export type MaxTransportCall = (input: {
  method: MaxApiReadMethod;
  token: string | null;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<MaxTransportResult>;

export type TanbotMaxConfig = {
  enabled: true;
  botToken: string;
  expectedUsername: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  tlsCaBundlePath: string | null;
};

export type TanbotMaxConfigLoadResult =
  | { ok: true; config: TanbotMaxConfig }
  | { ok: false; message: string };

export type MaxGetMeResult = {
  user_id: number;
  is_bot: true;
  username?: string;
  first_name?: string;
};

export type TanbotMaxProbeStatus =
  | "DISABLED"
  | "CONFIG_ERROR"
  | "LOCAL_OK"
  | "TLS_PROBE_OK"
  | "SUCCESS"
  | "AUTH_FAILED"
  | "USERNAME_MISMATCH"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "TLS_ERROR"
  | "API_ERROR";

export type TanbotMaxDiagnosticReport = {
  status: TanbotMaxProbeStatus;
  configured: boolean;
  enabled: boolean;
  stage: string;
  expectedUsername: string;
  botUsernameMatches: boolean | null;
  verifiedBotUserId: number | null;
  verifiedBotUsername: string | null;
  webhookConfigured: boolean | null;
  subscriptionCount: number | null;
  message: string;
  recommendation: string;
  checks: string[];
  checkedAt: string;
  durationMs: number;
  tlsCaBundleConfigured: boolean;
  credentialProxyNote: string;
};
