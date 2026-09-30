import type { Bitrix24TransportErrorCode, Bitrix24TransportFailure } from "./types";

export const SAFE_TRANSPORT_MESSAGES: Record<Bitrix24TransportErrorCode, string> = {
  NETWORK_ERROR: "Bitrix24 network request failed.",
  TIMEOUT: "Bitrix24 request timed out.",
  RESPONSE_TOO_LARGE: "Bitrix24 response exceeds the configured size limit.",
  INVALID_JSON: "Bitrix24 response is not valid JSON.",
  HTTP_ERROR: "Bitrix24 HTTP request failed.",
  API_ERROR: "Bitrix24 API returned an error.",
  UNAUTHORIZED: "Bitrix24 rejected webhook credentials.",
  FORBIDDEN: "Bitrix24 denied access for the webhook scope or user.",
  RATE_LIMITED: "Bitrix24 rate limit exceeded.",
  REDIRECT_BLOCKED: "Bitrix24 redirect responses are not followed.",
  HOST_BLOCKED: "Bitrix24 portal host is not allowed.",
  METHOD_NOT_ALLOWED: "Requested Bitrix24 method is not allowed.",
  TOTAL_DURATION_EXCEEDED: "Bitrix24 operation exceeded the configured total duration limit.",
  INVALID_ENVELOPE: "Bitrix24 response structure is invalid.",
};

export const SAFE_READ_MESSAGES = {
  INVALID_USER_ID: "Bitrix24 user ID must be a positive integer.",
  USER_NOT_FOUND: "Bitrix24 user was not found for the requested ID.",
  INVALID_ENVELOPE: "Bitrix24 response structure is invalid.",
  INVALID_RECORDS: "Bitrix24 response contained invalid task records.",
  EMPTY_PAGE_WITH_NEXT: "Bitrix24 returned an empty page while more data was indicated.",
} as const;

export const SAFE_CONFIG_MESSAGE = "Invalid Bitrix24 configuration.";

export function safeTransportFailure(
  code: Bitrix24TransportErrorCode,
  options: { httpStatus?: number; retryable?: boolean } = {},
): Bitrix24TransportFailure {
  return {
    ok: false,
    code,
    message: SAFE_TRANSPORT_MESSAGES[code],
    httpStatus: options.httpStatus,
    retryable: options.retryable ?? false,
  };
}

export function mapBitrixApiErrorCode(apiError: string): Bitrix24TransportFailure {
  if (apiError === "INVALID_CREDENTIALS" || apiError === "NO_AUTH_FOUND") {
    return safeTransportFailure("UNAUTHORIZED");
  }
  if (apiError === "insufficient_scope") {
    return safeTransportFailure("FORBIDDEN");
  }
  if (apiError === "QUERY_LIMIT_EXCEEDED") {
    return safeTransportFailure("RATE_LIMITED", { retryable: true });
  }
  return safeTransportFailure("API_ERROR");
}
