import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedExtendedClientRecord } from "../src/onec-clients/extended-types";
import { sha256Hex } from "../src/onec-clients/sha256";
import type { ValidatedClientsPayload } from "../src/onec-clients/types";
import {
  validateHoldingV2ClientsFileBytes,
  type ValidationResult,
} from "../src/onec-clients/validate";

const inputPath = process.env.AUDIT_CLIENTS_PATH?.trim();

export function safeIssue(issue: {
  code: string;
  field?: string;
  index?: number;
  outletIndex?: number;
}) {
  return {
    code: issue.code,
    field: issue.field,
    index: issue.index,
    outletIndex: issue.outletIndex,
  };
}

export function summarizeTypeCategoryFromRecords(records: ParsedExtendedClientRecord[]): {
  rowsWithTypeCategoryObject: number;
  rowsWithTypeCategoryFieldKeys: number;
} {
  let rowsWithTypeCategoryObject = 0;
  let rowsWithTypeCategoryFieldKeys = 0;
  for (const record of records) {
    if (record.typeCategory.objectPresentInSource) {
      rowsWithTypeCategoryObject += 1;
    }
    const presence = record.typeCategory.fieldPresence;
    if (
      presence.guidType ||
      presence.nameType ||
      presence.guidCategory ||
      presence.nameCategory
    ) {
      rowsWithTypeCategoryFieldKeys += 1;
    }
  }
  return { rowsWithTypeCategoryObject, rowsWithTypeCategoryFieldKeys };
}

export function buildHoldingV2DiagnoseReport(
  validated: ValidationResult,
  meta: {
    origin: "local_file" | "synthetic";
    sha256?: string;
    byteSize?: number;
    mtimeMs?: number;
  },
): Record<string, unknown> {
  const issueCount = validated.ok ? 0 : validated.issueCount;
  const invalidTypeCategoryCount = validated.ok
    ? 0
    : validated.issues.filter((i) => i.code === "INVALID_TYPE_CATEGORY").length;

  const base: Record<string, unknown> = {
    ok: validated.ok,
    origin: meta.origin,
    holdingExchangeSchema: "v2",
    issueCount,
    warningCount: validated.ok ? validated.payload.warningCount : validated.warningCount,
    issueCodes: validated.ok ? [] : validated.issueCodes ?? [],
    sampleIssues: validated.ok ? [] : validated.issues.slice(0, 20).map(safeIssue),
    compositionTallies: null as Record<string, number> | null,
    typeCategoryStats: {
      recordCount: null as number | null,
      rowsWithTypeCategoryObject: 0,
      rowsWithTypeCategoryFieldKeys: 0,
      invalidCount: invalidTypeCategoryCount,
    },
    diagnosticsTallies: null as Record<string, number> | null,
  };

  if (meta.sha256) {
    base.sha256 = meta.sha256;
  }
  if (meta.byteSize != null) {
    base.byteSize = meta.byteSize;
  }
  if (meta.mtimeMs != null) {
    base.mtimeMs = meta.mtimeMs;
  }

  if (!validated.ok) {
    return base;
  }

  const payload: ValidatedClientsPayload = validated.payload;
  const diagnostics = payload.holdingV2Diagnostics ?? null;
  const extended = payload.extendedRecords ?? [];
  const typeCategoryRows = summarizeTypeCategoryFromRecords(extended);
  const extDiag = payload.extendedDiagnostics;

  base.recordCount = payload.recordCount;
  base.compositionTallies = diagnostics?.compositionTypeDistribution ?? null;
  base.typeCategoryStats = {
    recordCount: payload.recordCount,
    rowsWithTypeCategoryObject: typeCategoryRows.rowsWithTypeCategoryObject,
    rowsWithTypeCategoryFieldKeys: typeCategoryRows.rowsWithTypeCategoryFieldKeys,
    invalidCount: invalidTypeCategoryCount,
  };
  base.diagnosticsTallies = diagnostics
    ? {
        legalEntityRowCount: diagnostics.legalEntityRowCount,
        holdingRootCount: diagnostics.holdingRootCount,
        uniqueOutletGuidCount: diagnostics.uniqueOutletGuidCount,
        activeOutletGuidCount: diagnostics.activeOutletGuidCount,
        closedOutletGuidCount: diagnostics.closedOutletGuidCount,
        unknownClosureOutletGuidCount: diagnostics.unknownClosureOutletGuidCount,
        outletRowsWithoutGuidStore: diagnostics.outletRowsWithoutGuidStore,
        duplicateOutletGuidCount: extDiag?.duplicateOutletGuidCount ?? 0,
        outletParentLinkConflicts: extDiag?.outletParentLinkConflicts ?? 0,
        holdingLinkErrors: extDiag?.holdingLinkErrors ?? 0,
      }
    : null;

  return base;
}

async function main(): Promise<void> {
  if (!inputPath) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          limitation: "AUDIT_CLIENTS_PATH not set; no local export file configured for read-only audit.",
        },
        null,
        2,
      ),
    );
    return;
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          errorCode: "AUDIT_FILE_NOT_FOUND",
          limitation: "File not found at AUDIT_CLIENTS_PATH",
        },
        null,
        2,
      ),
    );
    return;
  }
  try {
    const stat = fs.statSync(resolved);
    const bytes = fs.readFileSync(resolved);
    const sha256 = sha256Hex(bytes);
    const validated = validateHoldingV2ClientsFileBytes(bytes);
    const report = buildHoldingV2DiagnoseReport(validated, {
      origin: "local_file",
      sha256,
      byteSize: bytes.length,
      mtimeMs: stat.mtimeMs,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch {
    console.log(
      JSON.stringify(
        {
          ok: false,
          errorCode: "AUDIT_READ_FAILED",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === modulePath) {
  void main();
}
