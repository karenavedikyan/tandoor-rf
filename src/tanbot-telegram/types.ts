export const TELEGRAM_ALLOWED_METHODS = ["getMe", "getWebhookInfo"] as const;

export type TelegramAllowedMethod = (typeof TELEGRAM_ALLOWED_METHODS)[number];

export type TelegramTransportErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "HTTP_ERROR"
  | "API_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "METHOD_NOT_ALLOWED";

export type TelegramTransportFailure = {
  ok: false;
  code: TelegramTransportErrorCode;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
};

export type TelegramTransportSuccess = {
  ok: true;
  result: unknown;
};

export type TelegramTransportResult = TelegramTransportSuccess | TelegramTransportFailure;

export type TelegramTransportCall = (input: {
  method: TelegramAllowedMethod;
  token: string;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<TelegramTransportResult>;

export type TanbotTelegramConfig = {
  enabled: true;
  botToken: string;
  expectedUsername: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
};

export type TanbotTelegramConfigLoadResult =
  | { ok: true; config: TanbotTelegramConfig }
  | { ok: false; message: string };

export type TanbotTelegramProbeStatus =
  | "DISABLED"
  | "CONFIG_ERROR"
  | "LOCAL_OK"
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "USERNAME_MISMATCH"
  | "SUCCESS";

export type TanbotTelegramDiagnosticReport = {
  status: TanbotTelegramProbeStatus;
  configured: boolean;
  enabled: boolean;
  stage: "local" | "live_get_me" | "live_webhook_info" | "complete";
  expectedUsername: string;
  botUsernameMatches: boolean | null;
  verifiedBotId: number | null;
  verifiedBotUsername: string | null;
  webhookConfigured: boolean | null;
  pendingUpdateCount: number | null;
  lastWebhookErrorAt: string | null;
  lastWebhookErrorMessage: string | null;
  message: string;
  recommendation: string;
  checks: string[];
  checkedAt: string;
  durationMs: number;
};

export type TelegramGetMeResult = {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name?: string;
};

export type TelegramWebhookInfoResult = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
};
