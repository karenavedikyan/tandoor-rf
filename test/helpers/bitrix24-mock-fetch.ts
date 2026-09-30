import type { PinnedRequestFn, PinnedRequestOptions } from "../../src/bitrix24/pinned-request";
import type { ResolvedPortalAddress } from "../../src/bitrix24/dns-resolve";
import type { ResolvePortalAddressesFn } from "../../src/bitrix24/dns-resolve";

export type MockBitrixResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  text?: string;
  redirect?: boolean;
};

export function createBitrixMockPinnedRequest(
  handlers: Record<string, MockBitrixResponse | ((body: unknown) => MockBitrixResponse)>,
) {
  const calls: Array<{
    url: string;
    body: unknown;
    pinned: ResolvedPortalAddress;
  }> = [];

  const pinnedRequest: PinnedRequestFn = async (options: PinnedRequestOptions) => {
    const url = options.url.toString();
    const requestBody = JSON.parse(options.body);
    calls.push({ url, body: requestBody, pinned: options.pinned });

    const handler = handlers[url];
    const resolved =
      typeof handler === "function"
        ? handler(requestBody)
        : handler ?? { status: 404, body: { error: "NOT_FOUND" } };

    if (resolved.redirect) {
      return {
        statusCode: 302,
        headers: { location: "https://evil.example/rest/1/token/user.get" },
        body: "",
      };
    }

    const bodyText =
      resolved.text ?? (resolved.body !== undefined ? JSON.stringify(resolved.body) : "{}");

    return {
      statusCode: resolved.status ?? 200,
      headers: resolved.headers ?? {},
      body: bodyText,
    };
  };

  return { pinnedRequest, calls };
}

export function createSafePortalResolver(
  address = "93.184.216.34",
): ResolvePortalAddressesFn {
  return async () => [{ address, family: 4 }];
}

export function sampleWebhookConfig() {
  return {
    enabled: true as const,
    portalHost: "example.bitrix24.ru",
    portalId: "example.bitrix24.ru",
    webhookUserId: "1",
    webhookToken: "abc123secret",
    webhookBaseUrl: "https://example.bitrix24.ru/rest/1/abc123secret/",
    requestTimeoutMs: 5000,
    maxResponseBytes: 65536,
    maxPages: 5,
    maxTotalDurationMs: 15000,
  };
}
