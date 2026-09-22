import { isProduction, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../config";

const SESSION_MAX_AGE_SEC = Math.floor(SESSION_TTL_MS / 1000);

function cookieSuffixParts(maxAgeSec: number): string[] {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
  ];
  if (isProduction()) {
    parts.push("Secure");
  }
  return parts;
}

export function buildSessionCookie(token: string): string {
  const value = encodeURIComponent(token);
  return `${SESSION_COOKIE_NAME}=${value}; ${cookieSuffixParts(SESSION_MAX_AGE_SEC).join("; ")}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieSuffixParts(0).join("; ")}`;
}

export function parseSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader?.trim()) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const name = part.slice(0, idx).trim();
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }
    try {
      const raw = decodeURIComponent(part.slice(idx + 1).trim());
      return raw || null;
    } catch {
      return part.slice(idx + 1).trim() || null;
    }
  }

  return null;
}
