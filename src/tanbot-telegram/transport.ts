import { TELEGRAM_API_ORIGIN } from "./config";
import { mapTelegramHttpStatus, safeTransportFailure } from "./safe-errors";
import { redactTelegramSecrets } from "./sanitize";
import type {
  TelegramAllowedMethod,
  TelegramTransportCall,
  TelegramTransportResult,
} from "./types";

export function buildTelegramMethodUrl(token: string, method: TelegramAllowedMethod): string {
  return `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`;
}

function parseTelegramEnvelope(
  bodyText: string,
  token: string,
): TelegramTransportResult {
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
  const description =
    typeof envelope.description === "string"
      ? redactTelegramSecrets(envelope.description, [token])
      : "";
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
  if (description) {
    return {
      ok: false,
      code: "API_ERROR",
      message: redactTelegramSecrets("Telegram API returned an error.", [token]),
      httpStatus: errorCode,
      retryable: false,
    };
  }
  return safeTransportFailure("API_ERROR", { httpStatus: errorCode });
}

export function createDefaultTelegramTransport(fetchImpl: typeof fetch = fetch): TelegramTransportCall {
  return async ({ method, token, timeoutMs, maxResponseBytes }) => {
    const url = buildTelegramMethodUrl(token, method);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxResponseBytes) {
        return safeTransportFailure("RESPONSE_TOO_LARGE");
      }
      const bodyText = buffer.toString("utf8");
      if (!response.ok) {
        const parsed = parseTelegramEnvelope(bodyText, token);
        if (!parsed.ok) return parsed;
        return mapTelegramHttpStatus(response.status);
      }
      return parseTelegramEnvelope(bodyText, token);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return safeTransportFailure("TIMEOUT");
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
