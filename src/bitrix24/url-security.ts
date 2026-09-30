import { assertAllowedPortalHostname, buildPortalId, normalizePortalHostname } from "./portal-host";

export { buildPortalId };

export function parseWebhookUrl(rawUrl: string): {
  portalHost: string;
  webhookUserId: string;
  webhookToken: string;
  webhookBaseUrl: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("INVALID_WEBHOOK_URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("INVALID_WEBHOOK_URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("INVALID_WEBHOOK_URL");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("INVALID_WEBHOOK_URL");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new Error("INVALID_WEBHOOK_PORT");
  }

  const match = parsed.pathname.match(/^\/rest\/(\d+)\/([A-Za-z0-9]+)\/?$/);
  if (!match) {
    throw new Error("INVALID_WEBHOOK_URL");
  }

  const portalHost = normalizePortalHostname(parsed.hostname);
  assertAllowedPortalHostname(portalHost);

  const webhookUserId = match[1]!;
  const webhookToken = match[2]!;
  const webhookBaseUrl = `https://${portalHost}/rest/${webhookUserId}/${webhookToken}/`;

  return { portalHost, webhookUserId, webhookToken, webhookBaseUrl };
}
