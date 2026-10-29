import { readBoundedResponseBody } from "../tanbot-telegram/bounded-body";
import { MAX_API_ORIGIN } from "./config";
import { safeTransportFailure } from "./safe-errors";
import { redactMaxSecrets } from "./sanitize";
import {
  createMaxDispatcher,
  isLikelyTlsError,
  readMaxTlsCaBundle,
  wrapFetchWithMaxTls,
} from "./tls-fetch";
import { MAX_API_ALLOWED_METHODS, type MaxApiReadMethod, type MaxTransportCall, type MaxTransportResult } from "./types";

function buildMaxApiUrl(method: MaxApiReadMethod): string {
  if (method === "me") return `${MAX_API_ORIGIN}/me`;
  if (method === "subscriptions") return `${MAX_API_ORIGIN}/subscriptions`;
  return `${MAX_API_ORIGIN}/me`;
}

function assertAllowedMethod(method: string): method is MaxApiReadMethod {
  return (MAX_API_ALLOWED_METHODS as readonly string[]).includes(method);
}

function classifyHttpStatus(status: number): MaxTransportResult {
  if (status === 401) return safeTransportFailure("UNAUTHORIZED", { httpStatus: status });
  if (status === 403) return safeTransportFailure("FORBIDDEN", { httpStatus: status });
  if (status === 429) return safeTransportFailure("RATE_LIMITED", { httpStatus: status, retryable: true });
  if (status >= 500) return safeTransportFailure("API_ERROR", { httpStatus: status, retryable: true });
  return safeTransportFailure("HTTP_ERROR", { httpStatus: status });
}

function parseJsonBody(bodyText: string): MaxTransportResult {
  try {
    return { ok: true, result: JSON.parse(bodyText) as unknown };
  } catch {
    return safeTransportFailure("INVALID_JSON");
  }
}

export function createDefaultMaxTransport(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): MaxTransportCall {
  const ca = readMaxTlsCaBundle(env);
  const dispatcher = createMaxDispatcher(ca);
  const fetchWithTls = wrapFetchWithMaxTls(fetchImpl, dispatcher);

  return async ({ method, token, timeoutMs, maxResponseBytes }) => {
    if (!assertAllowedMethod(method)) {
      return safeTransportFailure("METHOD_NOT_ALLOWED");
    }

    const url = buildMaxApiUrl(method);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) {
      headers.Authorization = token;
    }

    try {
      const response = await fetchWithTls(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "error",
        headers,
      });

      const body = await readBoundedResponseBody(response, maxResponseBytes);
      if (!body.ok) {
        if (body.code === "RESPONSE_TOO_LARGE") {
          return safeTransportFailure("RESPONSE_TOO_LARGE");
        }
        return safeTransportFailure("NETWORK_ERROR", { retryable: true });
      }

      if (!response.ok) {
        return classifyHttpStatus(response.status);
      }

      return parseJsonBody(body.text);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return safeTransportFailure("TIMEOUT");
      }
      if (isLikelyTlsError(error)) {
        return safeTransportFailure("TLS_ERROR");
      }
      const message = error instanceof Error ? error.message : "MAX network request failed.";
      return {
        ok: false,
        code: "NETWORK_ERROR",
        message: redactMaxSecrets(message, token ? [token] : []),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** TLS reachability without sending a bot token (expects HTTP 401 from MAX). */
export async function maxTlsReachabilityProbe(
  transport: MaxTransportCall,
  options: { timeoutMs: number; maxResponseBytes: number },
): Promise<MaxTransportResult> {
  return transport({
    method: "me",
    token: null,
    timeoutMs: options.timeoutMs,
    maxResponseBytes: options.maxResponseBytes,
  });
}
