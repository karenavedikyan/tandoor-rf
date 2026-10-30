import { isIP } from "node:net";

/** Official MAX CDN / upload hosts (dev.max.ru media use-case). */
const DEFAULT_ALLOWED_HOST_SUFFIXES = [".oneme.ru", ".okcdn.ru"] as const;

function allowedHostSuffixes(): readonly string[] {
  const raw = process.env.TT_MAX_MEDIA_HOST_SUFFIXES?.trim();
  if (!raw) return DEFAULT_ALLOWED_HOST_SUFFIXES;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  for (const suffix of allowedHostSuffixes()) {
    const s = suffix.startsWith(".") ? suffix : `.${suffix}`;
    if (host === s.slice(1) || host.endsWith(s)) return true;
  }
  return false;
}

function isBlockedLiteralHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80:")) return true;
    return false;
  }
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export type MaxMediaUrlRejectReason =
  | "INVALID_URL"
  | "NOT_HTTPS"
  | "USERINFO"
  | "BAD_PORT"
  | "BLOCKED_HOST"
  | "HOST_NOT_ALLOWLISTED";

export function validateMaxMediaDownloadUrl(raw: string):
  | { ok: true; url: URL }
  | { ok: false; reason: MaxMediaUrlRejectReason } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "NOT_HTTPS" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "USERINFO" };
  }
  if (parsed.port && parsed.port !== "443") {
    return { ok: false, reason: "BAD_PORT" };
  }
  const host = parsed.hostname;
  if (!host || isBlockedLiteralHost(host)) {
    return { ok: false, reason: "BLOCKED_HOST" };
  }
  if (isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      return { ok: false, reason: "BLOCKED_HOST" };
    }
    return { ok: false, reason: "HOST_NOT_ALLOWLISTED" };
  }
  if (!hostAllowed(host)) {
    return { ok: false, reason: "HOST_NOT_ALLOWLISTED" };
  }
  return { ok: true, url: parsed };
}
