import type { TelegramTransportErrorCode, TelegramTransportFailure } from "./types";

export const SAFE_CONFIG_MESSAGE = "Invalid Tanbot Telegram configuration.";

export const SAFE_TRANSPORT_MESSAGES: Record<TelegramTransportErrorCode, string> = {
  NETWORK_ERROR: "Telegram network request failed.",
  TIMEOUT: "Telegram request timed out.",
  RESPONSE_TOO_LARGE: "Telegram response exceeds the configured size limit.",
  INVALID_JSON: "Telegram response is not valid JSON.",
  HTTP_ERROR: "Telegram HTTP request failed.",
  API_ERROR: "Telegram API returned an error.",
  UNAUTHORIZED: "Telegram rejected the bot token.",
  FORBIDDEN: "Telegram denied access for this bot.",
  RATE_LIMITED: "Telegram rate limit exceeded.",
  METHOD_NOT_ALLOWED: "Requested Telegram method is not allowed.",
};

export function safeTransportFailure(
  code: TelegramTransportErrorCode,
  options: { httpStatus?: number; retryable?: boolean } = {},
): TelegramTransportFailure {
  return {
    ok: false,
    code,
    message: SAFE_TRANSPORT_MESSAGES[code],
    httpStatus: options.httpStatus,
    retryable: options.retryable ?? false,
  };
}

export function mapTelegramHttpStatus(status: number): TelegramTransportFailure {
  if (status === 401) return safeTransportFailure("UNAUTHORIZED", { httpStatus: status });
  if (status === 403) return safeTransportFailure("FORBIDDEN", { httpStatus: status });
  if (status === 429) return safeTransportFailure("RATE_LIMITED", { httpStatus: status, retryable: true });
  if (status >= 500) return safeTransportFailure("API_ERROR", { httpStatus: status, retryable: true });
  return safeTransportFailure("HTTP_ERROR", { httpStatus: status });
}
