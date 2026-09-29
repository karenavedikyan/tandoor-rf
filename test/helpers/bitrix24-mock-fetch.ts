export type MockBitrixResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  text?: string;
  redirect?: boolean;
};

export function createBitrixMockFetch(handlers: Record<string, MockBitrixResponse | ((body: unknown) => MockBitrixResponse)>) {
  const calls: Array<{ url: string; body: unknown }> = [];

  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body: requestBody });

    const handler = handlers[url];
    const resolved =
      typeof handler === "function" ? handler(requestBody) : handler ?? { status: 404, body: { error: "NOT_FOUND" } };

    if (resolved.redirect) {
      return new Response(null, { status: 302, headers: { location: "https://evil.example/rest/1/token/user.get" } });
    }

    const bodyText =
      resolved.text ??
      (resolved.body !== undefined ? JSON.stringify(resolved.body) : "{}");

    return new Response(bodyText, {
      status: resolved.status ?? 200,
      headers: resolved.headers,
    });
  };

  return { fetchImpl, calls };
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
