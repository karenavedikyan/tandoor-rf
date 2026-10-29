import type { TanbotTelegramConfig, TanbotTelegramDiagnosticReport } from "./types";

export const MAX_DIAGNOSTIC_REPORT_BYTES = 65_536;

const TELEGRAM_BOT_URL_PATTERN = /https:\/\/api\.telegram\.org\/bot[^/\s]+/gi;

export function redactTelegramSecrets(value: string, secrets: string[] = []): string {
  let sanitized = value;
  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  sanitized = sanitized.replace(TELEGRAM_BOT_URL_PATTERN, "https://api.telegram.org/bot[redacted]");
  sanitized = sanitized.replace(/bot\d+:[A-Za-z0-9_-]+/gi, "bot[redacted]");
  return sanitized.replace(/[\r\n]+/g, " ").trim();
}

export function collectTelegramSecrets(config?: TanbotTelegramConfig): string[] {
  if (!config) return [];
  return [config.botToken];
}

export function sanitizeDiagnosticMessage(message: string, secrets: string[] = []): string {
  return redactTelegramSecrets(message, secrets).slice(0, 500);
}

export function sanitizeDiagnosticReport(
  report: TanbotTelegramDiagnosticReport,
  config?: TanbotTelegramConfig,
): TanbotTelegramDiagnosticReport {
  const secrets = collectTelegramSecrets(config);
  return {
    ...report,
    message: sanitizeDiagnosticMessage(report.message, secrets),
    recommendation: sanitizeDiagnosticMessage(report.recommendation, secrets),
    lastWebhookErrorMessage: report.lastWebhookErrorMessage
      ? sanitizeDiagnosticMessage(report.lastWebhookErrorMessage, secrets)
      : null,
    checks: report.checks.map((check) => sanitizeDiagnosticMessage(check, secrets)),
    verifiedBotUsername: report.verifiedBotUsername
      ? sanitizeDiagnosticMessage(report.verifiedBotUsername, secrets)
      : null,
  };
}

export function formatDiagnosticReportForCli(report: TanbotTelegramDiagnosticReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function diagnosticReportByteLength(report: TanbotTelegramDiagnosticReport): number {
  return Buffer.byteLength(formatDiagnosticReportForCli(report), "utf8");
}
