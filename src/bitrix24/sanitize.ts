import type { Bitrix24ProbeResult, Bitrix24WebhookConfig } from "./types";

export const MAX_PROBE_REPORT_BYTES = 65_536;

export function redactBitrixSecrets(
  value: string,
  secrets: string[] = [],
): string {
  let sanitized = value;
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  sanitized = sanitized.replace(/https:\/\/[^\s/]+\/rest\/\d+\/[A-Za-z0-9]+/g, "https://[portal]/rest/[user]/[redacted]");
  sanitized = sanitized.replace(/[\r\n]+/g, " ").trim();
  return sanitized;
}

export function sanitizeProbeMessage(message: string, secrets: string[] = []): string {
  return redactBitrixSecrets(message, secrets).slice(0, 500);
}

export function collectBitrixSecrets(config?: Bitrix24WebhookConfig): string[] {
  if (!config) {
    return [];
  }
  return [config.webhookToken, config.webhookBaseUrl];
}

export function sanitizeProbeResult(
  result: Bitrix24ProbeResult,
  config?: Bitrix24WebhookConfig,
): Bitrix24ProbeResult {
  const secrets = collectBitrixSecrets(config);
  return {
    ...result,
    message: sanitizeProbeMessage(result.message, secrets),
    checks: result.checks.map((check) => sanitizeProbeMessage(check, secrets)),
    unavailableFeatures: result.unavailableFeatures?.map((feature) =>
      sanitizeProbeMessage(feature, secrets),
    ),
  };
}

export function formatProbeReportForCli(result: Bitrix24ProbeResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function probeReportByteLength(result: Bitrix24ProbeResult): number {
  return Buffer.byteLength(formatProbeReportForCli(result), "utf8");
}
