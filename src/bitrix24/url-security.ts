import type { Bitrix24DnsLookup } from "./types";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (mapped.includes(".")) {
      return isPrivateIpv4(mapped);
    }
  }
  return false;
}

export function isBlockedIpAddress(address: string): boolean {
  if (address.includes(":")) {
    return isPrivateIpv6(address);
  }
  return isPrivateIpv4(address);
}

export function assertAllowedPortalHostname(hostname: string): void {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("Bitrix24 portal host is required.");
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    throw new Error("Bitrix24 portal host points to a blocked local or service hostname.");
  }
  if (normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    throw new Error("Bitrix24 portal host must not use local or internal domain suffixes.");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized) || normalized.includes(":")) {
    throw new Error("Bitrix24 portal host must be a public DNS hostname, not an IP address.");
  }
}

export async function assertPortalHostResolvesSafely(
  hostname: string,
  lookup: Bitrix24DnsLookup,
): Promise<void> {
  assertAllowedPortalHostname(hostname);
  const resolved = await lookup(normalizeHostname(hostname));
  if (isBlockedIpAddress(resolved.address)) {
    throw new Error("Bitrix24 portal host resolves to a blocked local or private address.");
  }
}

export function buildPortalId(portalHost: string): string {
  return normalizeHostname(portalHost);
}

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
    throw new Error("BITRIX24_WEBHOOK_URL must be a valid HTTPS URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("BITRIX24_WEBHOOK_URL must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("BITRIX24_WEBHOOK_URL must not contain embedded credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("BITRIX24_WEBHOOK_URL must not contain query or hash segments.");
  }

  const match = parsed.pathname.match(/^\/rest\/(\d+)\/([A-Za-z0-9]+)\/?$/);
  if (!match) {
    throw new Error(
      "BITRIX24_WEBHOOK_URL must match https://<portal>/rest/<user_id>/<webhook_token>/",
    );
  }

  const portalHost = normalizeHostname(parsed.hostname);
  assertAllowedPortalHostname(portalHost);

  const webhookUserId = match[1]!;
  const webhookToken = match[2]!;
  const webhookBaseUrl = `https://${portalHost}/rest/${webhookUserId}/${webhookToken}/`;

  return { portalHost, webhookUserId, webhookToken, webhookBaseUrl };
}
