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
    ? []
    : [...new Set(validated.issues.map((issue) => issue.code))].sort();
  const warningCodes = validated.ok
    ? [...new Set(validated.payload.warnings.map((warning) => warning.code))].sort()
    : [...new Set(validated.warnings.map((warning) => warning.code))].sort();

  const report: ExtendedStructureReport = {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    remotePath: "/LC/clients/all_clients.json",
    sourceModifiedAt: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    records: parsed.length,
    sourceFormat,
    diagnostics: validated.ok ? validated.payload.diagnostics : null,
    validation: {
      ok: validated.ok,
      issueCount: validated.ok ? 0 : validated.issueCount,
      warningCount: validated.ok ? validated.payload.warningCount : validated.warningCount,
      issueCodes,
      warningCodes,
    },
  };

  if (Buffer.byteLength(JSON.stringify(report)) > 2_000_000) {
    throw new Error("REPORT_TOO_LARGE");
  }
  return report;
}
