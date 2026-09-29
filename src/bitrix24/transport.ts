import { OperationDeadline } from "./deadline";
import { resolvePortalAddressesSafely } from "./dns-resolve";
import { executePinnedHttpsRequest, type PinnedRequestFn } from "./pinned-request";
import { assertAllowedPortalHostname } from "./portal-host";
import { mapBitrixApiErrorCode, safeTransportFailure } from "./safe-errors";
import { BITRIX24_ALLOWED_METHODS } from "./types";
import type {
  Bitrix24AllowedMethod,
  Bitrix24OperationContext,
  Bitrix24TransportFailure,
  Bitrix24TransportResult,
  Bitrix24WebhookConfig,
} from "./types";

const MAX_READ_RETRIES = 3;

export type Bitrix24TransportOptions = {
  operation?: Bitrix24OperationContext;
  pinnedRequest?: PinnedRequestFn;
};

function isAllowedMethod(method: string): method is Bitrix24AllowedMethod {
  return (BITRIX24_ALLOWED_METHODS as readonly string[]).includes(method);
}

function buildMethodUrl(config: Bitrix24WebhookConfig, method: Bitrix24AllowedMethod): URL {
  return new URL(`${config.webhookBaseUrl}${method}`);
}

function parseRetryAfterMs(
  headers: Record<string, string | string[] | undefined>,
  now: () => number,
): number | null {
  const raw = headers["retry-after"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.min(dateMs - now(), 60_000));
  }
  return null;
}

function mapThrownError(error: unknown): Bitrix24TransportFailure {
  if (error instanceof Error) {
    switch (error.message) {
      case "TIMEOUT":
      case "ABORTED":
        return safeTransportFailure("TIMEOUT", { retryable: true });
      case "RESPONSE_TOO_LARGE":
        return safeTransportFailure("RESPONSE_TOO_LARGE");
      case "REDIRECT_BLOCKED":
        return safeTransportFailure("REDIRECT_BLOCKED");
      case "HOST_BLOCKED":
        return safeTransportFailure("HOST_BLOCKED");
      case "TOTAL_DURATION_EXCEEDED":
        return safeTransportFailure("TOTAL_DURATION_EXCEEDED");
      default:
        break;
    }
  }
  return safeTransportFailure("NETWORK_ERROR", { retryable: true });
}

function parseBitrixResponse(body: string): Bitrix24TransportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return safeTransportFailure("INVALID_JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    return safeTransportFailure("INVALID_JSON");
  }

  const payload = parsed as Record<string, unknown>;
  if (typeof payload.error === "string") {
    return mapBitrixApiErrorCode(payload.error);
  }

  const next =
    payload.next === undefined || payload.next === null
      ? null
      : typeof payload.next === "number" && Number.isInteger(payload.next) && payload.next >= 0
        ? payload.next
        : null;
  if (payload.next !== undefined && payload.next !== null && next === null) {
    return safeTransportFailure("INVALID_ENVELOPE");
  }

  const total =
    payload.total === undefined || payload.total === null
      ? null
      : typeof payload.total === "number" && Number.isInteger(payload.total) && payload.total >= 0
        ? payload.total
        : null;
  if (payload.total !== undefined && payload.total !== null && total === null) {
    return safeTransportFailure("INVALID_ENVELOPE");
  }

  return {
    ok: true,
    result: payload.result,
    next,
    total,
  };
}

function classifyHttpFailure(status: number, body: string): Bitrix24TransportResult {
  const parsed = parseBitrixResponse(body);
  if (!parsed.ok) {
    if (status === 401) {
      return safeTransportFailure("UNAUTHORIZED");
    }
    if (status === 403) {
      return safeTransportFailure("FORBIDDEN");
    }
    if (status === 429) {
      return safeTransportFailure("RATE_LIMITED", { retryable: true });
    }
    if (status >= 500) {
      return safeTransportFailure("HTTP_ERROR", { httpStatus: status, retryable: true });
    }
    return safeTransportFailure("HTTP_ERROR", { httpStatus: status });
  }

  if (status === 401) {
    return safeTransportFailure("UNAUTHORIZED");
  }
  if (status === 403) {
    return safeTransportFailure("FORBIDDEN");
  }
  if (status === 429) {
    return safeTransportFailure("RATE_LIMITED", { retryable: true });
  }
  if (status >= 500) {
    return safeTransportFailure("HTTP_ERROR", { httpStatus: status, retryable: true });
  }
  return safeTransportFailure("HTTP_ERROR", { httpStatus: status });
}

export function createOperationContext(
  config: Bitrix24WebhookConfig,
  startedAtMs?: number,
): Bitrix24OperationContext {
  return {
    deadline: OperationDeadline.fromDuration(config.maxTotalDurationMs, startedAtMs),
  };
}

export async function callBitrix24Method(
  config: Bitrix24WebhookConfig,
  method: Bitrix24AllowedMethod,
  body: Record<string, unknown>,
  options: Bitrix24TransportOptions = {},
): Promise<Bitrix24TransportResult> {
  if (!isAllowedMethod(method)) {
    return safeTransportFailure("METHOD_NOT_ALLOWED");
  }

  const operation =
    options.operation ??
    createOperationContext(config);
  const deadline = operation.deadline;
  const pinnedRequest = options.pinnedRequest ?? operation.pinnedRequest ?? executePinnedHttpsRequest;
  const resolvePortalAddresses = operation.resolvePortalAddresses;

  if (deadline.expired()) {
    return safeTransportFailure("TOTAL_DURATION_EXCEEDED");
  }

  try {
    assertAllowedPortalHostname(config.portalHost);
  } catch {
    return safeTransportFailure("HOST_BLOCKED");
  }

  let pinned;
  try {
    pinned = await resolvePortalAddressesSafely(
      config.portalHost,
      deadline,
      resolvePortalAddresses
        ? (hostname) => resolvePortalAddresses(hostname, deadline)
        : undefined,
    );
  } catch (error) {
    return mapThrownError(error);
  }

  const url = buildMethodUrl(config, method);
  let attempt = 0;

  while (attempt < MAX_READ_RETRIES) {
    attempt += 1;
    if (deadline.expired()) {
      return safeTransportFailure("TOTAL_DURATION_EXCEEDED");
    }

    const timeoutMs = Math.min(config.requestTimeoutMs, deadline.remainingMs());
    if (timeoutMs <= 0) {
      return safeTransportFailure("TOTAL_DURATION_EXCEEDED");
    }

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await pinnedRequest({
        url,
        pinned,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        signal: controller.signal,
      });

      if (response.statusCode >= 300 && response.statusCode < 400) {
        return safeTransportFailure("REDIRECT_BLOCKED", { httpStatus: response.statusCode });
      }

      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        const failure = classifyHttpFailure(response.statusCode, response.body);
        if (failure.ok === false && failure.retryable && attempt < MAX_READ_RETRIES) {
          const retryAfterMs = parseRetryAfterMs(response.headers, Date.now);
          const waitMs = retryAfterMs ?? Math.min(1000 * attempt, 5000);
          if (waitMs > deadline.remainingMs()) {
            return failure;
          }
          const slept = await deadline.sleep(waitMs);
          if (!slept) {
            return safeTransportFailure("TOTAL_DURATION_EXCEEDED");
          }
          continue;
        }
        return failure;
      }

      const parsed = parseBitrixResponse(response.body);
      if (!parsed.ok && parsed.retryable && attempt < MAX_READ_RETRIES) {
        const waitMs = Math.min(1000 * attempt, 5000);
        if (waitMs > deadline.remainingMs()) {
          return parsed;
        }
        const slept = await deadline.sleep(waitMs);
        if (!slept) {
          return safeTransportFailure("TOTAL_DURATION_EXCEEDED");
        }
        continue;
      }
      return parsed;
    } catch (error) {
      const mapped = mapThrownError(error);
      if (mapped.retryable && attempt < MAX_READ_RETRIES) {
        const waitMs = Math.min(1000 * attempt, 5000);
        if (waitMs > deadline.remainingMs()) {
          return mapped;
        }
        const slept = await deadline.sleep(waitMs);
        if (!slept) {
          return safeTransportFailure("TOTAL_DURATION_EXCEEDED");
        }
        continue;
      }
      return mapped;
    } finally {
      clearTimeout(abortTimer);
    }
  }

  return safeTransportFailure("NETWORK_ERROR");
}
