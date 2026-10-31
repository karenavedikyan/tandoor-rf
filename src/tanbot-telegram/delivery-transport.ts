import { readBoundedResponseBody } from "./bounded-body";
import { TELEGRAM_API_ORIGIN } from "./config";
import { safeTransportFailure } from "./safe-errors";
import { redactTelegramSecrets } from "./sanitize";

export const TELEGRAM_DELIVERY_METHODS = ["sendMessage", "sendPhoto", "answerCallbackQuery"] as const;
export type TelegramDeliveryMethod = (typeof TELEGRAM_DELIVERY_METHODS)[number];

export type TelegramDeliveryResult =
  | { ok: true; result: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      httpStatus?: number;
      retryable?: boolean;
      retryAfterSeconds?: number;
    };

export type TelegramDeliveryTransport = (input: {
  method: TelegramDeliveryMethod;
  token: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<TelegramDeliveryResult>;

function buildUrl(token: string, method: TelegramDeliveryMethod): string {
  return `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`;
}

function parseEnvelope(bodyText: string, token: string): TelegramDeliveryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return safeTransportFailure("INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    return safeTransportFailure("INVALID_JSON");
  }
  const envelope = parsed as {
    ok?: unknown;
    result?: unknown;
    error_code?: unknown;
    description?: unknown;
    parameters?: { retry_after?: unknown };
  };
  if (envelope.ok === true) {
    return { ok: true, result: envelope.result };
  }
  const errorCode = typeof envelope.error_code === "number" ? envelope.error_code : undefined;
  const retryAfter =
    envelope.parameters && typeof envelope.parameters.retry_after === "number"
      ? envelope.parameters.retry_after
      : undefined;
  if (errorCode === 401) return { ...safeTransportFailure("UNAUTHORIZED", { httpStatus: 401 }), code: "UNAUTHORIZED" };
  if (errorCode === 403) return { ...safeTransportFailure("FORBIDDEN", { httpStatus: 403 }), code: "FORBIDDEN" };
  if (errorCode === 429) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "Telegram rate limit.",
      httpStatus: 429,
      retryable: true,
      retryAfterSeconds: retryAfter,
    };
  }
  if (errorCode !== undefined && errorCode >= 500) {
    return {
      ok: false,
      code: "API_ERROR",
      message: "Telegram API error.",
      httpStatus: errorCode,
      retryable: true,
    };
  }
  void redactTelegramSecrets(String(envelope.description ?? ""), [token]);
  return { ok: false, code: "API_ERROR", message: "Telegram API error.", httpStatus: errorCode };
}

export function createDefaultTelegramDeliveryTransport(fetchImpl: typeof fetch = fetch): TelegramDeliveryTransport {
  return async ({ method, token, body, timeoutMs, maxResponseBytes }) => {
    if (!TELEGRAM_DELIVERY_METHODS.includes(method)) {
      return { ok: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed." };
    }
    const url = buildUrl(token, method);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      const bodyResult = await readBoundedResponseBody(response, maxResponseBytes);
      if (!bodyResult.ok) {
        return bodyResult.code === "RESPONSE_TOO_LARGE"
          ? safeTransportFailure("RESPONSE_TOO_LARGE")
          : safeTransportFailure("INVALID_JSON");
      }
      const text = bodyResult.text;
      if (!response.ok) {
        if (response.status === 429) {
          const parsed = parseEnvelope(text, token);
          if (!parsed.ok && parsed.code === "RATE_LIMITED") return parsed;
          return {
            ok: false,
            code: "RATE_LIMITED",
            message: "Telegram rate limit.",
            httpStatus: 429,
            retryable: true,
          };
        }
        if (response.status >= 500) {
          return {
            ok: false,
            code: "HTTP_ERROR",
            message: "Telegram HTTP error.",
            httpStatus: response.status,
            retryable: true,
          };
        }
        return parseEnvelope(text, token);
      }
      return parseEnvelope(text, token);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: "TIMEOUT", message: "Telegram request timed out.", retryable: true };
      }
      return { ok: false, code: "NETWORK_ERROR", message: "Telegram network error.", retryable: true };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** In-memory transport for integration tests (no live Telegram). */
export function createRecordingTelegramDeliveryTransport(
  sink: { calls: Array<{ method: string; body: Record<string, unknown> }> },
): TelegramDeliveryTransport {
  return async ({ method, body }) => {
    sink.calls.push({ method, body: { ...body } });
    return { ok: true, result: { message_id: sink.calls.length } };
  };
}
