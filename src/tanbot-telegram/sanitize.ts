import { DEFAULT_EXPECTED_BOT_USERNAME } from "./config";
import type { TanbotTelegramConfig, TanbotTelegramDiagnosticReport } from "./types";

export const MAX_DIAGNOSTIC_REPORT_BYTES = 65_536;
export const MAX_PUBLIC_ERROR_SNIPPET = 200;

const TELEGRAM_BOT_URL_PATTERN = /https:\/\/api\.telegram\.org\/bot[^/\s]+/gi;
const GENERIC_HTTP_URL_PATTERN = /https?:\/\/[^\s]+/gi;
const BOT_TOKEN_FRAGMENT_PATTERN = /\d{6,}:[A-Za-z0-9_-]{8,}/g;

/** Public username label only — never echo arbitrary env values. */
export function publicExpectedUsername(configured?: string): string {
  const normalized = (configured ?? DEFAULT_EXPECTED_BOT_USERNAME).trim().replace(/^@+/, "");
  if (/^[A-Za-z0-9_]{5,32}$/.test(normalized)) {
    return normalized;
  }
  return DEFAULT_EXPECTED_BOT_USERNAME;
}

export function redactTelegramSecrets(value: string, secrets: string[] = []): string {
  let sanitized = value;
  const sortedSecrets = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of sortedSecrets) {
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  sanitized = sanitized.replace(TELEGRAM_BOT_URL_PATTERN, "https://api.telegram.org/bot[redacted]");
  sanitized = sanitized.replace(BOT_TOKEN_FRAGMENT_PATTERN, "bot[redacted]");
  sanitized = sanitized.replace(GENERIC_HTTP_URL_PATTERN, "[url-redacted]");
  return sanitized.replace(/[\r\n]+/g, " ").trim();
}

export function collectTelegramSecrets(config?: TanbotTelegramConfig): string[] {
  if (!config) return [];
  return [config.botToken];
}

export function sanitizeDiagnosticMessage(message: string, secrets: string[] = []): string {
  const redacted = redactTelegramSecrets(message, secrets);
  if (!redacted) return "";
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

export const GENERIC_WEBHOOK_ERROR_MESSAGE =
  "Telegram reported a webhook delivery error (details withheld).";

export function sanitizeDiagnosticReport(
  report: TanbotTelegramDiagnosticReport,
  config?: TanbotTelegramConfig,
): TanbotTelegramDiagnosticReport {
  const secrets = collectTelegramSecrets(config);
  return {
    ...report,
    expectedUsername: publicExpectedUsername(report.expectedUsername),
    message: sanitizeDiagnosticMessage(report.message, secrets),
    recommendation: sanitizeDiagnosticMessage(report.recommendation, secrets),
    lastWebhookErrorMessage: report.lastWebhookErrorMessage
      ? sanitizeDiagnosticMessage(report.lastWebhookErrorMessage, secrets)
      : null,
    checks: report.checks.map((check) => sanitizeDiagnosticMessage(check, secrets)),
    verifiedBotUsername: report.verifiedBotUsername
      ? publicExpectedUsername(report.verifiedBotUsername)
      : null,
  };
}

export function formatDiagnosticReportForCli(report: TanbotTelegramDiagnosticReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function diagnosticReportByteLength(report: TanbotTelegramDiagnosticReport): number {
  return Buffer.byteLength(formatDiagnosticReportForCli(report), "utf8");
}
