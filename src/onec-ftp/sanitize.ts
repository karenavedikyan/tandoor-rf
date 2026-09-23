import type { OnecFtpFileEntry, OnecFtpProbeResult } from "./types";

const SECRET_KEYS = ["password", "ONEC_FTP_PASSWORD"] as const;

export const MAX_PROBE_STRING_FIELD_LENGTH = 500;
export const MAX_PROBE_REPORT_BYTES = 65_536;

export function formatProbeReportForCli(result: OnecFtpProbeResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function probeReportByteLength(result: OnecFtpProbeResult): number {
  return Buffer.byteLength(formatProbeReportForCli(result), "utf8");
}

export function redactSecrets(value: string, secrets: string[] = []): string {
  let sanitized = value;
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  sanitized = sanitized.replace(/[\r\n]+/g, " ").trim();
  sanitized = sanitized.replace(/ftp:\/\/[^\s]+/gi, "ftp://[redacted]");
  sanitized = sanitized.replace(/ONEC_FTP_PASSWORD=[^\s]+/gi, "ONEC_FTP_PASSWORD=[redacted]");
  return sanitized;
}

export function sanitizeProbeMessage(message: string, secrets: string[] = []): string {
  return redactSecrets(message, secrets).slice(0, MAX_PROBE_STRING_FIELD_LENGTH);
}

function sanitizeOptionalString(
  value: string | undefined,
  secrets: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return redactSecrets(value, secrets).slice(0, MAX_PROBE_STRING_FIELD_LENGTH);
}

function sanitizeFileEntry(entry: OnecFtpFileEntry, secrets: string[]): OnecFtpFileEntry {
  return {
    ...entry,
    name: redactSecrets(entry.name, secrets).slice(0, MAX_PROBE_STRING_FIELD_LENGTH),
    modifiedAt: entry.modifiedAt
      ? redactSecrets(entry.modifiedAt, secrets).slice(0, MAX_PROBE_STRING_FIELD_LENGTH)
      : null,
  };
}

function removeSecretKeys(clone: Record<string, unknown>): void {
  for (const key of SECRET_KEYS) {
    delete clone[key];
  }
}

function fitsProbeReportLimit(result: OnecFtpProbeResult): boolean {
  return probeReportByteLength(result) <= MAX_PROBE_REPORT_BYTES;
}

function limitReportSize(result: OnecFtpProbeResult): OnecFtpProbeResult {
  if (fitsProbeReportLimit(result)) {
    return result;
  }

  if (result.files && result.files.length > 0) {
    let files = result.files;
    while (files.length > 0 && !fitsProbeReportLimit({ ...result, files })) {
      files = files.slice(0, Math.max(0, files.length - 1));
    }
    const limited: OnecFtpProbeResult = {
      ...result,
      files,
      fileCount: files.length,
      truncated: true,
      message: sanitizeProbeMessage(result.message),
    };
    if (fitsProbeReportLimit(limited)) {
      return limited;
    }
  }

  const { files: _files, fileCount: _fileCount, truncated: _truncated, ...withoutFiles } = result;
  const compact: OnecFtpProbeResult = {
    ...withoutFiles,
    truncated: true,
    message: sanitizeProbeMessage(
      "Probe report exceeded the allowed size limit; file listing omitted.",
    ),
  };
  return compact;
}

export function sanitizeProbeResult(
  result: OnecFtpProbeResult,
  secrets: string[] = [],
): OnecFtpProbeResult {
  const clone = structuredClone(result) as OnecFtpProbeResult & Record<string, unknown>;
  removeSecretKeys(clone);

  clone.message = sanitizeProbeMessage(clone.message, secrets);
  clone.basePath = sanitizeOptionalString(clone.basePath, secrets);
  clone.workingDirectory = sanitizeOptionalString(clone.workingDirectory, secrets);

  if (clone.files) {
    clone.files = clone.files.map((entry) => sanitizeFileEntry(entry, secrets));
  }

  return limitReportSize(clone);
}
