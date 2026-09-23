const SECRET_KEYS = ["password", "ONEC_FTP_PASSWORD"] as const;

export function sanitizeProbeMessage(message: string, secrets: string[] = []): string {
  let sanitized = message.replace(/[\r\n]+/g, " ").trim();
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  sanitized = sanitized.replace(/ftp:\/\/[^\s]+/gi, "ftp://[redacted]");
  sanitized = sanitized.replace(/ONEC_FTP_PASSWORD=[^\s]+/gi, "ONEC_FTP_PASSWORD=[redacted]");
  return sanitized.slice(0, 500);
}

export function sanitizeProbeResult<T extends Record<string, unknown>>(
  result: T,
  secrets: string[] = [],
): T {
  const clone = structuredClone(result) as Record<string, unknown>;
  if (typeof clone.message === "string") {
    clone.message = sanitizeProbeMessage(clone.message, secrets);
  }
  for (const key of SECRET_KEYS) {
    delete clone[key];
  }
  return clone as T;
}
