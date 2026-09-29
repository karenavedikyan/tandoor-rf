import dns from "node:dns/promises";
import { BITRIX24_ALLOWED_METHODS } from "./types";
import { assertPortalHostResolvesSafely } from "./url-security";
import type {
  Bitrix24AllowedMethod,
  Bitrix24DnsLookup,
  Bitrix24Fetch,
  Bitrix24TransportFailure,
  Bitrix24TransportResult,
  Bitrix24WebhookConfig,
} from "./types";

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const MAX_READ_RETRIES = 3;

export type Bitrix24TransportOptions = {
  fetchImpl?: Bitrix24Fetch;
  lookup?: Bitrix24DnsLookup;
  startedAt?: number;
  maxTotalDurationMs?: number;
};

function defaultLookup(hostname: string) {
  return dns.lookup(hostname, { verbatim: true });
}

function isAllowedMethod(method: string): method is Bitrix24AllowedMethod {
  return (BITRIX24_ALLOWED_METHODS as readonly string[]).includes(method);
}

function buildMethodUrl(config: Bitrix24WebhookConfig, method: Bitrix24AllowedMethod): string {
  return `${config.webhookBaseUrl}${method}`;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error("RESPONSE_TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.min(dateMs - Date.now(), 60_000));
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyHttpFailure(status: number, apiError?: string): Bitrix24TransportFailure {
  if (status === 401) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Bitrix24 rejected webhook credentials.",
      httpStatus: status,
      apiError,
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Bitrix24 denied access for the webhook scope or user.",
      httpStatus: status,
      apiError,
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "Bitrix24 rate limit exceeded.",
      httpStatus: status,
      apiError,
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      code: "HTTP_ERROR",
      message: "Bitrix24 server error.",
      httpStatus: status,
      apiError,
      retryable: true,
    };
  }
  return {
    ok: false,
    code: "HTTP_ERROR",
    message: "Bitrix24 HTTP request failed.",
    httpStatus: status,
    apiError,
    retryable: false,
  };
}

function parseBitrixResponse(body: string): Bitrix24TransportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      code: "INVALID_JSON",
      message: "Bitrix24 response is not valid JSON.",
      retryable: false,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      code: "INVALID_JSON",
      message: "Bitrix24 response JSON must be an object.",
      retryable: false,
    };
  }

  const payload = parsed as Record<string, unknown>;
  if (typeof payload.error === "string") {
    const apiError = payload.error;
    const description =
      typeof payload.error_description === "string" ? payload.error_description : undefined;
    const message = description ?? "Bitrix24 API returned an error.";
    if (apiError === "INVALID_CREDENTIALS" || apiError === "NO_AUTH_FOUND") {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message,
        apiError,
        retryable: false,
      };
    }
    if (apiError === "insufficient_scope") {
      return {
        ok: false,
        code: "FORBIDDEN",
        message,
        apiError,
        retryable: false,
      };
    }
    if (apiError === "QUERY_LIMIT_EXCEEDED") {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message,
        apiError,
        retryable: true,
      };
    }
    return {
      ok: false,
      code: "API_ERROR",
      message,
      apiError,
      retryable: false,
    };
  }

  const next =
    typeof payload.next === "number" && Number.isFinite(payload.next) ? payload.next : null;
  const total =
    typeof payload.total === "number" && Number.isFinite(payload.total) ? payload.total : null;

  return {
    ok: true,
    result: payload.result,
    next,
    total,
  };
}

export async function callBitrix24Method(
  config: Bitrix24WebhookConfig,
  method: Bitrix24AllowedMethod,
  body: Record<string, unknown>,
  options: Bitrix24TransportOptions = {},
): Promise<Bitrix24TransportResult> {
  if (!isAllowedMethod(method)) {
    return {
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      message: "Requested Bitrix24 method is not allowed.",
      retryable: false,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const lookup = options.lookup ?? defaultLookup;
  const startedAt = options.startedAt ?? Date.now();
  const maxTotalDurationMs = options.maxTotalDurationMs ?? config.maxTotalDurationMs;

  try {
    await assertPortalHostResolvesSafely(config.portalHost, lookup);
  } catch (error) {
    return {
      ok: false,
      code: "HOST_BLOCKED",
      message: error instanceof Error ? error.message : "Bitrix24 portal host is blocked.",
      retryable: false,
    };
  }

  const url = buildMethodUrl(config, method);
  let attempt = 0;

  while (attempt < MAX_READ_RETRIES) {
    attempt += 1;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= maxTotalDurationMs) {
      return {
        ok: false,
        code: "TOTAL_DURATION_EXCEEDED",
        message: "Bitrix24 request exceeded the configured total duration limit.",
        retryable: false,
      };
    }

    const timeoutMs = Math.min(config.requestTimeoutMs, maxTotalDurationMs - elapsed);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        return {
          ok: false,
          code: "REDIRECT_BLOCKED",
          message: "Bitrix24 redirect responses are not followed.",
          httpStatus: response.status,
          retryable: false,
        };
      }

      let bodyText: string;
      try {
        bodyText = await readLimitedBody(response, config.maxResponseBytes);
      } catch (error) {
        if (error instanceof Error && error.message === "RESPONSE_TOO_LARGE") {
          return {
            ok: false,
            code: "RESPONSE_TOO_LARGE",
            message: "Bitrix24 response exceeds the configured size limit.",
            retryable: false,
          };
        }
        throw error;
      }

      if (!response.ok) {
        const parsedFailure = parseBitrixResponse(bodyText);
        const apiError = !parsedFailure.ok ? parsedFailure.apiError : undefined;
        const failure = classifyHttpFailure(response.status, apiError);
        if (failure.retryable && attempt < MAX_READ_RETRIES) {
          const retryAfterMs = parseRetryAfterMs(response) ?? Math.min(1000 * attempt, 5000);
          await sleep(retryAfterMs);
          continue;
        }
        return failure;
      }

      const parsed = parseBitrixResponse(bodyText);
      if (!parsed.ok && parsed.retryable && attempt < MAX_READ_RETRIES) {
        await sleep(Math.min(1000 * attempt, 5000));
        continue;
      }
      return parsed;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (isAbort) {
        return {
          ok: false,
          code: "TIMEOUT",
          message: "Bitrix24 request timed out.",
          retryable: attempt < MAX_READ_RETRIES,
        };
      }
      if (attempt < MAX_READ_RETRIES) {
        await sleep(Math.min(1000 * attempt, 5000));
        continue;
      }
      return {
        ok: false,
        code: "NETWORK_ERROR",
        message: "Bitrix24 network request failed.",
        retryable: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    code: "NETWORK_ERROR",
    message: "Bitrix24 request failed after retries.",
    retryable: false,
  };
}

export function isRetryableTransportFailure(result: Bitrix24TransportFailure): boolean {
  return result.retryable || RETRYABLE_HTTP_STATUSES.has(result.httpStatus ?? 0);
}
