import { DEFAULT_EXPECTED_BOT_USERNAME } from "./config";
import type { TanbotMaxConfig, TanbotMaxDiagnosticReport } from "./types";

export const CREDENTIAL_PROXY_BOUNDARY_NOTE =
  "Configuring TANBOT_MAX_TLS_CA_BUNDLE on the LK server does not fix TLS trust in a separate credential proxy (e.g. Computer read-only checks). Live token validation requires server-side TLS + token on the app host.";

const MAX_API_URL_PATTERN = /https:\/\/platform-api2\.max\.ru[^\s]*/gi;
const GENERIC_HTTP_URL_PATTERN = /https?:\/\/[^\s]+/gi;
const TOKEN_LIKE_PATTERN = /[\x21-\x7E]{16,512}/g;

export function publicExpectedUsername(configured?: string): string {
  const normalized = (configured ?? DEFAULT_EXPECTED_BOT_USERNAME).trim().replace(/^@+/, "");
  if (/^[A-Za-z0-9_]{3,64}$/.test(normalized)) {
    return normalized;
  }
  return DEFAULT_EXPECTED_BOT_USERNAME;
}

export function redactMaxSecrets(value: string, secrets: string[] = []): string {
  let sanitized = value;
  const sortedSecrets = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of sortedSecrets) {
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  sanitized = sanitized.replace(MAX_API_URL_PATTERN, "https://platform-api2.max.ru/[redacted]");
  sanitized = sanitized.replace(TOKEN_LIKE_PATTERN, (match) =>
    match.length >= 24 ? "[redacted]" : match,
  );
  sanitized = sanitized.replace(GENERIC_HTTP_URL_PATTERN, "[url-redacted]");
  return sanitized.replace(/[\r\n]+/g, " ").trim();
}

export function collectMaxSecrets(config?: TanbotMaxConfig): string[] {
  if (!config) return [];
  return [config.botToken];
}

function sanitizeMessage(message: string, secrets: string[]): string {
  const redacted = redactMaxSecrets(message, secrets);
  if (!redacted) return "";
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

export function sanitizeDiagnosticReport(
  report: TanbotMaxDiagnosticReport,
  config?: TanbotMaxConfig,
): TanbotMaxDiagnosticReport {
  const secrets = collectMaxSecrets(config);
  return {
    ...report,
    expectedUsername: publicExpectedUsername(report.expectedUsername),
    message: sanitizeMessage(report.message, secrets),
    recommendation: sanitizeMessage(report.recommendation, secrets),
    checks: report.checks.map((check) => sanitizeMessage(check, secrets)),
    verifiedBotUsername: report.verifiedBotUsername
      ? publicExpectedUsername(report.verifiedBotUsername)
      : null,
    credentialProxyNote: report.credentialProxyNote,
  };
}

export function formatDiagnosticReportForCli(report: TanbotMaxDiagnosticReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
