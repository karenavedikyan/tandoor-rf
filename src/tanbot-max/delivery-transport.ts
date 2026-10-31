import { readBoundedResponseBody } from "../tanbot-telegram/bounded-body";
import { MAX_API_ORIGIN } from "./config";
import { safeTransportFailure } from "./safe-errors";
import { redactMaxSecrets } from "./sanitize";
import { createMaxDispatcher, isLikelyTlsError, readMaxTlsCaBundle, wrapFetchWithMaxTls } from "./tls-fetch";

export type MaxCallbackButton = { type: "callback"; text: string; payload: string };
export type MaxRequestContactButton = { type: "request_contact"; text: string };
export type MaxLinkButton = { type: "link"; text: string; url: string };
export type MaxInlineButton = MaxCallbackButton | MaxRequestContactButton | MaxLinkButton;

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
  inlineButtons?: MaxInlineButton[][];
  shareUrl?: string;
  maxImageToken?: string;
}) => Promise<MaxDeliveryResult>;

/** Documented success: HTTP 200 with message object (not necessarily success:true). */
export function parseMaxSendResult(bodyText: string, httpStatus: number): MaxDeliveryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return safeTransportFailure("INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    return safeTransportFailure("INVALID_JSON");
  }
  const row = parsed as { success?: unknown; message?: unknown; code?: unknown };
  if (row.success === false) {
    return { ok: false, code: "API_ERROR", message: "MAX API error.", httpStatus: httpStatus || 400 };
  }
  if (row.message && typeof row.message === "object") {
    return { ok: true, result: parsed };
  }
  if (row.success === true) {
    return { ok: true, result: parsed };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return { ok: true, result: parsed };
  }
  return { ok: false, code: "API_ERROR", message: "MAX API error.", httpStatus };
}

function maxButtonToWire(b: MaxInlineButton): Record<string, string> {
  if (b.type === "request_contact") {
    return { type: "request_contact", text: b.text };
  }
  if (b.type === "link") {
    return { type: "link", text: b.text, url: b.url };
  }
  return { type: "callback", text: b.text, payload: b.payload };
}

export function buildMaxShareAttachment(shareUrl: string): { type: "share"; payload: { url: string } } {
  return { type: "share", payload: { url: shareUrl } };
}

export function buildMaxImageAttachment(token: string): { type: "image"; payload: { token: string } } {
  return { type: "image", payload: { token: token.trim() } };
}

export function buildMaxInlineKeyboardAttachment(buttons: MaxInlineButton[][]) {
  return {
    type: "inline_keyboard",
    payload: {
      buttons: buttons.map((row) => row.map((b) => maxButtonToWire(b))),
    },
  };
}

export function buildMaxSendMessagePayload(input: {
  text: string;
  inlineButtons?: MaxInlineButton[][];
  shareUrl?: string;
  maxImageToken?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { text: input.text };
  const attachments: unknown[] = [];
  if (input.maxImageToken?.trim()) {
    attachments.push(buildMaxImageAttachment(input.maxImageToken.trim()));
  }
  if (input.shareUrl?.trim()) {
    attachments.push(buildMaxShareAttachment(input.shareUrl.trim()));
  }
  if (input.inlineButtons?.length) {
    attachments.push(buildMaxInlineKeyboardAttachment(input.inlineButtons));
  }
  if (attachments.length) {
    body.attachments = attachments;
  }
  return body;
}

export function createDefaultMaxDeliveryTransport(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): MaxDeliveryTransport {
  const ca = readMaxTlsCaBundle(env);
  const fetchWithTls = wrapFetchWithMaxTls(fetchImpl, createMaxDispatcher(ca));

  return async ({ token, userId, text, timeoutMs, maxResponseBytes, inlineButtons, shareUrl, maxImageToken }) => {
    const url = `${MAX_API_ORIGIN}/messages?user_id=${encodeURIComponent(userId.toString())}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const body = buildMaxSendMessagePayload({ text, inlineButtons, shareUrl, maxImageToken });
    try {
      const response = await fetchWithTls(url, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
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
      const parsed = parseMaxSendResult(bodyResult.text, response.status);
      if (!parsed.ok && response.ok) {
        return parsed;
      }
      if (!response.ok) {
        return parsed.ok ? parsed : parseMaxSendResult(bodyResult.text, response.status);
      }
      return parsed;
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
  sink: {
    calls: Array<{
      userId: string;
      text: string;
      inlineButtons?: MaxInlineButton[][];
      shareUrl?: string;
      maxImageToken?: string;
    }>;
  },
): MaxDeliveryTransport {
  return async ({ userId, text, inlineButtons, shareUrl, maxImageToken }) => {
    sink.calls.push({ userId: userId.toString(), text, inlineButtons, shareUrl, maxImageToken });
    return { ok: true, result: { message: { mid: "test-mid" } } };
  };
}
