import fs from "node:fs";
import path from "node:path";
import { sha256Hex } from "../src/onec-clients/sha256";
import { validateHoldingV2ClientsFileBytes } from "../src/onec-clients/validate";

const inputPath = process.env.AUDIT_CLIENTS_PATH?.trim();

function safeIssue(issue: {
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
          limitation: "File not found at AUDIT_CLIENTS_PATH",
          path: resolved,
        },
        null,
        2,
      ),
    );
    return;
  }
  const stat = fs.statSync(resolved);
  const bytes = fs.readFileSync(resolved);
  const sha256 = sha256Hex(bytes);
  const validated = validateHoldingV2ClientsFileBytes(bytes);
  const report = {
    ok: validated.ok,
    origin: "local_file",
    path: resolved,
    mtimeMs: stat.mtimeMs,
    sha256,
    byteSize: bytes.length,
    holdingExchangeSchema: "v2",
    issueCount: validated.ok ? 0 : validated.issueCount,
    warningCount: validated.ok ? validated.payload.warningCount : validated.warningCount,
    issueCodes: validated.ok ? [] : validated.issueCodes,
    sampleIssues: validated.ok ? [] : validated.issues.slice(0, 20).map(safeIssue),
    recordCount: validated.ok ? validated.payload.recordCount : undefined,
  };
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace("file://", ""));
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { safeIssue };
