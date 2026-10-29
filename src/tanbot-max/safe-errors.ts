import type { MaxTransportErrorCode, MaxTransportFailure } from "./types";

export const SAFE_CONFIG_MESSAGE = "Invalid Tanbot MAX configuration.";

export const SAFE_TRANSPORT_MESSAGES: Record<MaxTransportErrorCode, string> = {
  NETWORK_ERROR: "MAX network request failed.",
  TLS_ERROR: "MAX TLS certificate validation failed.",
  TIMEOUT: "MAX request timed out.",
  RESPONSE_TOO_LARGE: "MAX response exceeds the configured size limit.",
  INVALID_JSON: "MAX response is not valid JSON.",
  HTTP_ERROR: "MAX HTTP request failed.",
  API_ERROR: "MAX API returned an error.",
  UNAUTHORIZED: "MAX rejected the bot token.",
  FORBIDDEN: "MAX denied access for this bot.",
  RATE_LIMITED: "MAX rate limit exceeded.",
  METHOD_NOT_ALLOWED: "Requested MAX method is not allowed.",
};

export function safeTransportFailure(
  code: MaxTransportErrorCode,
  options: { httpStatus?: number; retryable?: boolean } = {},
): MaxTransportFailure {
  return {
    ok: false,
    code,
    message: SAFE_TRANSPORT_MESSAGES[code],
    httpStatus: options.httpStatus,
    retryable: options.retryable ?? false,
  };
}
