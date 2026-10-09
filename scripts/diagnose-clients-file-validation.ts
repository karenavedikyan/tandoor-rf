/**
 * Read-only validation diagnostics for all_clients.json (no DB, no FTP, no apply).
 *
 * Usage on Computer after downloading the bundle locally:
 *   AUDIT_CLIENTS_PATH=/path/to/all_clients.json node --import tsx scripts/diagnose-clients-file-validation.ts
 *
 * Prints JSON only: SHA-256, record count, issue codes, and field paths (no values / PII).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { validateClientsFileBytes } from "../src/onec-clients/validate";
import type { ValidationIssue } from "../src/onec-clients/types";

const path = process.env.AUDIT_CLIENTS_PATH?.trim() ?? "";

/** Safe subset for operators: codes and indices only, never business values. */
export function safeValidationIssueForReport(issue: ValidationIssue) {
  const row: {
    code: string;
    field?: string;
    index?: number;
    outletIndex?: number;
  } = { code: issue.code };
  if ("field" in issue && typeof issue.field === "string") {
    row.field = issue.field;
  }
  if ("index" in issue && typeof issue.index === "number") {
    row.index = issue.index;
  }
  if ("outletIndex" in issue && typeof issue.outletIndex === "number") {
    row.outletIndex = issue.outletIndex;
  }
  return row;
}

export function diagnoseClientsFileBytes(bytes: Buffer, labelPath: string) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let recordCount: number | null = null;
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    recordCount = Array.isArray(parsed) ? parsed.length : null;
  } catch {
    recordCount = null;
  }

  const validated = validateClientsFileBytes(bytes);
  if (validated.ok) {
    return {
      exitCode: 0 as const,
      body: {
        ok: true,
        path: labelPath,
        sha256,
        bytes: bytes.length,
        recordCount: validated.payload.recordCount,
        sourceFormat: validated.payload.sourceFormat,
        firstReadWouldPass: true,
        note: "Roster-coupled bundle validation is not run here; use regular-update dry-run locally with both files for full bundle checks.",
      },
    };
  }

  return {
    exitCode: 2 as const,
    body: {
      ok: false,
      path: labelPath,
      sha256,
      bytes: bytes.length,
      recordCount,
      firstReadWouldPass: false,
      issueCount: validated.issueCount,
      warningCount: validated.warningCount,
      issueCodes: validated.issueCodes ?? [...new Set(validated.issues.map((i) => i.code))],
      warningCodes: validated.warningCodes,
      issuesTruncated: validated.issuesTruncated ?? false,
      sampleIssues: validated.issues.slice(0, 20).map(safeValidationIssueForReport),
    },
  };
}

function main(): void {
  if (!path) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: "AUDIT_CLIENTS_PATH not set",
          hint: "Set AUDIT_CLIENTS_PATH to a local copy of all_clients.json",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (!existsSync(path)) {
    console.log(JSON.stringify({ ok: false, error: "file_not_found", path }, null, 2));
    process.exit(1);
  }

  const bytes = readFileSync(path);
  const result = diagnoseClientsFileBytes(bytes, path);
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.exitCode);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("diagnose-clients-file-validation.ts") ||
    process.argv[1].endsWith("diagnose-clients-file-validation.js"));

if (isDirectRun) {
  main();
}
