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

function safeIssue(issue: ValidationIssue) {
  return {
    code: issue.code,
    field: "field" in issue ? issue.field : undefined,
    index: "index" in issue ? issue.index : undefined,
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
    console.log(
      JSON.stringify(
        {
          ok: true,
          path,
          sha256,
          bytes: bytes.length,
          recordCount: validated.payload.recordCount,
          sourceFormat: validated.payload.sourceFormat,
          firstReadWouldPass: true,
          note: "Roster-coupled bundle validation is not run here; use regular-update dry-run locally with both files for full bundle checks.",
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: false,
        path,
        sha256,
        bytes: bytes.length,
        recordCount,
        firstReadWouldPass: false,
        issueCount: validated.issueCount,
        warningCount: validated.warningCount,
        issueCodes: validated.issueCodes ?? [...new Set(validated.issues.map((i) => i.code))],
        warningCodes: validated.warningCodes,
        issuesTruncated: validated.issuesTruncated ?? false,
        sampleIssues: validated.issues.slice(0, 20).map(safeIssue),
        extendedDiagnostics: validated.extendedDiagnostics ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

main();
