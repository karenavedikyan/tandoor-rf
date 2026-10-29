import { TELEGRAM_API_ORIGIN } from "./config";
import { readBoundedResponseBody } from "./bounded-body";
import { mapTelegramHttpStatus, safeTransportFailure } from "./safe-errors";
import { redactTelegramSecrets } from "./sanitize";
import {
  TELEGRAM_ALLOWED_METHODS,
  type TelegramAllowedMethod,
  type TelegramTransportCall,
  type TelegramTransportResult,
} from "./types";

export function buildTelegramMethodUrl(token: string, method: TelegramAllowedMethod): string {
  return `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`;
}

function assertAllowedMethod(method: string): method is TelegramAllowedMethod {
  return (TELEGRAM_ALLOWED_METHODS as readonly string[]).includes(method);
}

function classifyHttpError(status: number, bodyText: string, token: string): TelegramTransportResult {
  if (status === 401) return safeTransportFailure("UNAUTHORIZED", { httpStatus: status });
  if (status === 403) return safeTransportFailure("FORBIDDEN", { httpStatus: status });
  if (status === 429) return safeTransportFailure("RATE_LIMITED", { httpStatus: status, retryable: true });
  if (status >= 500) return safeTransportFailure("API_ERROR", { httpStatus: status, retryable: true });

  const parsed = parseTelegramEnvelope(bodyText, token);
  if (!parsed.ok && parsed.code === "INVALID_JSON") {
    return safeTransportFailure("HTTP_ERROR", { httpStatus: status });
  }
  return parsed;
}

function parseTelegramEnvelope(bodyText: string, token: string): TelegramTransportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return safeTransportFailure("INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    return safeTransportFailure("INVALID_JSON");
  }
  const envelope = parsed as { ok?: unknown; result?: unknown; description?: unknown; error_code?: unknown };
  if (envelope.ok === true) {
    return { ok: true, result: envelope.result };
  }
  const errorCode = typeof envelope.error_code === "number" ? envelope.error_code : undefined;
  if (errorCode === 401) {
    return safeTransportFailure("UNAUTHORIZED", { httpStatus: 401 });
  }
  if (errorCode === 403) {
    return safeTransportFailure("FORBIDDEN", { httpStatus: 403 });
  }
  if (errorCode === 429) {
    return safeTransportFailure("RATE_LIMITED", { httpStatus: 429, retryable: true });
  }
  if (errorCode !== undefined && errorCode >= 500) {
    return safeTransportFailure("API_ERROR", { httpStatus: errorCode, retryable: true });
  }
  void envelope.description;
  return safeTransportFailure("API_ERROR", { httpStatus: errorCode });
}

export function createDefaultTelegramTransport(fetchImpl: typeof fetch = fetch): TelegramTransportCall {
  return async ({ method, token, timeoutMs, maxResponseBytes }) => {
    if (!assertAllowedMethod(method)) {
      return safeTransportFailure("METHOD_NOT_ALLOWED");
    }

    const url = buildTelegramMethodUrl(token, method);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "application/json" },
      });

      const body = await readBoundedResponseBody(response, maxResponseBytes);
      if (!body.ok) {
        if (body.code === "RESPONSE_TOO_LARGE") {
          return safeTransportFailure("RESPONSE_TOO_LARGE");
        }
        return safeTransportFailure("NETWORK_ERROR", { retryable: true });
      }

      if (!response.ok) {
        return classifyHttpError(response.status, body.text, token);
      }

      return parseTelegramEnvelope(body.text, token);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return safeTransportFailure("TIMEOUT");
      }
      if (error instanceof Error && /redirect/i.test(error.message)) {
        return safeTransportFailure("NETWORK_ERROR", { retryable: false });
      }
      const message = error instanceof Error ? error.message : "Telegram network request failed.";
      return {
        ok: false,
        code: "NETWORK_ERROR",
        message: redactTelegramSecrets(message, [token, url]),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
