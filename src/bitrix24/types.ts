export const BITRIX24_ALLOWED_METHODS = ["user.get", "tasks.task.list"] as const;

export type Bitrix24AllowedMethod = (typeof BITRIX24_ALLOWED_METHODS)[number];

export type Bitrix24WebhookConfig = {
  enabled: true;
  portalHost: string;
  portalId: string;
  webhookUserId: string;
  webhookToken: string;
  webhookBaseUrl: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxPages: number;
  maxTotalDurationMs: number;
};

export type Bitrix24ConfigLoadResult =
  | { ok: true; config: Bitrix24WebhookConfig }
  | { ok: false; message: string };

export type Bitrix24TransportErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "HTTP_ERROR"
  | "API_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "REDIRECT_BLOCKED"
  | "HOST_BLOCKED"
  | "METHOD_NOT_ALLOWED"
  | "TOTAL_DURATION_EXCEEDED";

export type Bitrix24TransportSuccess = {
  ok: true;
  result: unknown;
  next: number | null;
  total: number | null;
};

export type Bitrix24TransportFailure = {
  ok: false;
  code: Bitrix24TransportErrorCode;
  message: string;
  httpStatus?: number;
  apiError?: string;
  retryable: boolean;
};

export type Bitrix24TransportResult = Bitrix24TransportSuccess | Bitrix24TransportFailure;

export type Bitrix24TaskStatusLabel =
  | "unknown"
  | "waiting"
  | "in_progress"
  | "awaiting_control"
  | "completed"
  | "deferred";

export type Bitrix24NormalizedUser = {
  portalHost: string;
  bitrixUserId: string;
  active: boolean | null;
};

export type Bitrix24NormalizedTask = {
  portalHost: string;
  taskId: string;
  title: string;
  statusRaw: string | number | null;
  statusLabel: Bitrix24TaskStatusLabel;
  responsibleId: string | null;
  createdById: string | null;
  deadline: string | null;
  changedAt: string | null;
};

export type Bitrix24TaskListTruncationReason =
  | "MAX_PAGES"
  | "MAX_DURATION"
  | "DUPLICATE_CURSOR"
  | "INVALID_PAGE";

export type Bitrix24TaskListResult = {
  tasks: Bitrix24NormalizedTask[];
  totalReported: number | null;
  pagesFetched: number;
  complete: boolean;
  truncatedReason?: Bitrix24TaskListTruncationReason;
};

export type Bitrix24ProbeStatus =
  | "DISABLED"
  | "CONFIG_ERROR"
  | "LOCAL_OK"
  | "SUCCESS"
  | "PARTIAL"
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "API_ERROR"
  | "INVALID_USER"
  | "LIVE_REQUIRES_USER";

export type Bitrix24ProbeResult = {
  status: Bitrix24ProbeStatus;
  durationMs: number;
  message: string;
  portalId?: string;
  checks: string[];
  bitrixUserId?: string;
  usersChecked?: number;
  tasksFetched?: number;
  tasksComplete?: boolean;
  unavailableFeatures?: string[];
  errorCode?: string;
};

export type Bitrix24Fetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type Bitrix24DnsLookup = (
  hostname: string,
) => Promise<{ address: string; family: number }>;
