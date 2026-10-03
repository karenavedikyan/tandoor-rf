import { createHash } from "node:crypto";
import { MAX_SOURCE_BYTES, MAX_SOURCE_RECORDS } from "../onec-clients/constants";
import { detectClientsSourceFormat } from "../onec-clients/format";
import { validateExtendedClientsFileBytes } from "../onec-clients/extended-validate";
import type { ExtendedDiagnosticsSummary } from "../onec-clients/extended-types";

export type ExtendedStructureReport = {
  schemaVersion: 2;
  checkedAt: string;
  remotePath: "/LC/clients/all_clients.json";
  sourceModifiedAt: null;
  sha256: string;
  bytes: number;
  records: number;
  sourceFormat: "legacy" | "extended_v1";
  diagnostics: ExtendedDiagnosticsSummary | null;
  validation: {
    ok: boolean;
    issueCount: number;
    warningCount: number;
    issueCodes: string[];
    warningCodes: string[];
    issuesTruncated: boolean;
    warningsTruncated: boolean;
  };
};

/** Safe extended-structure report without PII, contacts, or raw records. */
export function buildExtendedStructureReport(bytes: Buffer): ExtendedStructureReport {
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!Array.isArray(parsed) || parsed.length > MAX_SOURCE_RECORDS) {
    throw new Error("INVALID_PAYLOAD");
  }

  const sourceFormat = detectClientsSourceFormat(parsed);
  const validated = validateExtendedClientsFileBytes(bytes);
  const issueCodes = validated.ok
    ? (validated.payload.issueCodes ?? [])
    : validated.issueCodes;
  const warningCodes = validated.ok
    ? (validated.payload.warningCodes ?? [])
    : validated.warningCodes;

  const report: ExtendedStructureReport = {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    remotePath: "/LC/clients/all_clients.json",
    sourceModifiedAt: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    records: parsed.length,
    sourceFormat,
    diagnostics: validated.ok ? validated.payload.diagnostics : validated.diagnostics,
    validation: {
      ok: validated.ok,
      issueCount: validated.ok ? 0 : validated.issueCount,
      warningCount: validated.ok ? validated.payload.warningCount : validated.warningCount,
      issueCodes,
      warningCodes,
      issuesTruncated: validated.ok ? false : validated.issuesTruncated,
      warningsTruncated: validated.ok
        ? (validated.payload.warningsTruncated ?? false)
        : validated.warningsTruncated,
    },
  };

  if (Buffer.byteLength(JSON.stringify(report)) > 2_000_000) {
    throw new Error("REPORT_TOO_LARGE");
  }
  return report;
}
