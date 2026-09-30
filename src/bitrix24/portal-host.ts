const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

export function normalizePortalHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function assertAllowedPortalHostname(hostname: string): void {
  const normalized = normalizePortalHostname(hostname);
  if (!normalized) {
    throw new Error("HOST_BLOCKED");
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    throw new Error("HOST_BLOCKED");
  }
  if (normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    throw new Error("HOST_BLOCKED");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized) || normalized.includes(":")) {
    throw new Error("HOST_BLOCKED");
  }
}

export function buildPortalId(portalHost: string): string {
  return normalizePortalHostname(portalHost);
}
