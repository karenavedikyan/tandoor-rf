import { readBoundedResponseBody } from "../tanbot-telegram/bounded-body";
import { MAX_API_ORIGIN } from "./config";
import { safeTransportFailure } from "./safe-errors";
import { redactMaxSecrets } from "./sanitize";
import { createMaxDispatcher, isLikelyTlsError, readMaxTlsCaBundle, wrapFetchWithMaxTls } from "./tls-fetch";

export type MaxDeliveryResult =
  | { ok: true; result: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      httpStatus?: number;
      retryable?: boolean;
      retryAfterSeconds?: number;
    };

export type MaxDeliveryTransport = (input: {
  token: string;
  userId: bigint;
  text: string;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<MaxDeliveryResult>;

function parseMaxSendResult(bodyText: string): MaxDeliveryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return safeTransportFailure("INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    return safeTransportFailure("INVALID_JSON");
  }
  const row = parsed as { success?: unknown; message?: unknown };
  if (row.success === true) {
    return { ok: true, result: parsed };
  }
  return { ok: false, code: "API_ERROR", message: "MAX API error.", httpStatus: 400 };
}

export function createDefaultMaxDeliveryTransport(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): MaxDeliveryTransport {
  const ca = readMaxTlsCaBundle(env);
  const fetchWithTls = wrapFetchWithMaxTls(fetchImpl, createMaxDispatcher(ca));

  return async ({ token, userId, text, timeoutMs, maxResponseBytes }) => {
    const url = `${MAX_API_ORIGIN}/messages?user_id=${encodeURIComponent(userId.toString())}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchWithTls(url, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
        redirect: "error",
      });
      const bodyResult = await readBoundedResponseBody(response, maxResponseBytes);
      if (!bodyResult.ok) {
        return bodyResult.code === "RESPONSE_TOO_LARGE"
          ? safeTransportFailure("RESPONSE_TOO_LARGE")
          : safeTransportFailure("INVALID_JSON");
      }
      if (response.status === 401) {
        return { ...safeTransportFailure("UNAUTHORIZED", { httpStatus: 401 }), code: "UNAUTHORIZED" };
      }
      if (response.status === 403) {
        return { ...safeTransportFailure("FORBIDDEN", { httpStatus: 403 }), code: "FORBIDDEN" };
      }
      if (response.status === 429) {
        return {
          ok: false,
          code: "RATE_LIMITED",
          message: "MAX rate limit.",
          httpStatus: 429,
          retryable: true,
        };
      }
      if (response.status >= 500) {
        return {
          ok: false,
          code: "HTTP_ERROR",
          message: "MAX HTTP error.",
          httpStatus: response.status,
          retryable: true,
        };
      }
      if (!response.ok) {
        return parseMaxSendResult(bodyResult.text);
      }
      return parseMaxSendResult(bodyResult.text);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: "TIMEOUT", message: "MAX request timed out.", retryable: true };
      }
      if (isLikelyTlsError(err)) {
        return { ...safeTransportFailure("TLS_ERROR"), code: "TLS_ERROR" };
      }
      const message = err instanceof Error ? err.message : "MAX network error.";
      return {
        ok: false,
        code: "NETWORK_ERROR",
        message: redactMaxSecrets(message, [token]),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createRecordingMaxDeliveryTransport(
  sink: { calls: Array<{ userId: string; text: string }> },
): MaxDeliveryTransport {
  return async ({ userId, text }) => {
    sink.calls.push({ userId: userId.toString(), text });
    return { ok: true, result: { success: true } };
  };
}
