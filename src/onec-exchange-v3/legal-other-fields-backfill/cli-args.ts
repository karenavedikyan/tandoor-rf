import { isAbsolute, resolve } from "node:path";
import { isSha256Hex } from "../../onec-clients/sha256";

export type LegalOtherFieldsBackfillCliOptions = {
  mode: "dry_run" | "apply";
  /** Local path for tests; production default is FTP `/LC/clients/all_clients.json`. */
  clientsFilePath?: string;
  expectedSourceSha256?: string;
  expectedPlanHash?: string;
  confirmTargetDb?: string;
};

export type LegalOtherFieldsBackfillCliParseResult =
  | { ok: true; options: LegalOtherFieldsBackfillCliOptions }
  | {
      ok: false;
      code:
        | "UNKNOWN_ARGUMENT"
        | "CLIENTS_FILE_REQUIRED"
        | "APPLY_REQUIRES_EXPECTED_SOURCE_SHA256"
        | "APPLY_REQUIRES_EXPECTED_PLAN_HASH"
        | "APPLY_REQUIRES_CONFIRM_TARGET_DB"
        | "INVALID_EXPECTED_SOURCE_SHA256"
        | "INVALID_EXPECTED_PLAN_HASH"
        | "INVALID_CONFIRM_TARGET_DB"
        | "APPLY_AND_DRY_RUN";
    };

export const LEGAL_OTHER_FIELDS_BACKFILL_CLI_ERRORS: Record<string, string> = {
  UNKNOWN_ARGUMENT: "Unknown CLI argument.",
  CLIENTS_FILE_REQUIRED: "--clients-file requires a file path when provided.",
  APPLY_REQUIRES_EXPECTED_SOURCE_SHA256:
    "Apply requires --expected-source-sha256 from a verified dry-run of the same clients file.",
  APPLY_REQUIRES_EXPECTED_PLAN_HASH:
    "Apply requires --expected-plan-hash from a verified dry-run of the same clients file.",
  APPLY_REQUIRES_CONFIRM_TARGET_DB: "Apply requires --confirm-target-db from dry-run target DB identity.",
  INVALID_EXPECTED_SOURCE_SHA256: "--expected-source-sha256 must be a 64-character hex SHA-256.",
  INVALID_EXPECTED_PLAN_HASH: "--expected-plan-hash must be a 64-character hex SHA-256.",
  INVALID_CONFIRM_TARGET_DB: "--confirm-target-db must be a 64-character hex target DB fingerprint.",
  APPLY_AND_DRY_RUN: "Use either --apply or --dry-run, not both.",
};

export function resolveClientsFilePath(filePath: string, cwd = process.cwd()): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function readFlagValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } | null {
  const arg = argv[index];
  if (arg === flag) {
    const value = argv[index + 1]?.trim();
    if (!value) {
      return null;
    }
    return { value, nextIndex: index + 1 };
  }
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1).trim();
    if (!value) {
      return null;
    }
    return { value, nextIndex: index };
  }
  return null;
}

export function parseLegalOtherFieldsBackfillCliArgs(argv: string[]): LegalOtherFieldsBackfillCliParseResult {
  let mode: LegalOtherFieldsBackfillCliOptions["mode"] = "dry_run";
  let clientsFilePath: string | undefined;
  let expectedSourceSha256: string | undefined;
  let expectedPlanHash: string | undefined;
  let confirmTargetDb: string | undefined;
  let sawDryRun = false;
  let sawApply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      sawDryRun = true;
      mode = "dry_run";
      continue;
    }
    if (arg === "--apply") {
      sawApply = true;
      mode = "apply";
      continue;
    }
    const clientsFile = readFlagValue(argv, index, "--clients-file");
    if (clientsFile) {
      clientsFilePath = clientsFile.value;
      index = clientsFile.nextIndex;
      continue;
    }
    const expectedSha = readFlagValue(argv, index, "--expected-source-sha256");
    if (expectedSha) {
      expectedSourceSha256 = expectedSha.value.toLowerCase();
      index = expectedSha.nextIndex;
      continue;
    }
    const expectedPlan = readFlagValue(argv, index, "--expected-plan-hash");
    if (expectedPlan) {
      expectedPlanHash = expectedPlan.value.toLowerCase();
      index = expectedPlan.nextIndex;
      continue;
    }
    const confirmDb = readFlagValue(argv, index, "--confirm-target-db");
    if (confirmDb) {
      confirmTargetDb = confirmDb.value.toLowerCase();
      index = confirmDb.nextIndex;
      continue;
    }
    return { ok: false, code: "UNKNOWN_ARGUMENT" };
  }

  if (sawDryRun && sawApply) {
    return { ok: false, code: "APPLY_AND_DRY_RUN" };
  }
  if (mode === "apply") {
    if (!expectedSourceSha256) {
      return { ok: false, code: "APPLY_REQUIRES_EXPECTED_SOURCE_SHA256" };
    }
    if (!expectedPlanHash) {
      return { ok: false, code: "APPLY_REQUIRES_EXPECTED_PLAN_HASH" };
    }
    if (!confirmTargetDb) {
      return { ok: false, code: "APPLY_REQUIRES_CONFIRM_TARGET_DB" };
    }
    if (!isSha256Hex(expectedSourceSha256)) {
      return { ok: false, code: "INVALID_EXPECTED_SOURCE_SHA256" };
    }
    if (!isSha256Hex(expectedPlanHash)) {
      return { ok: false, code: "INVALID_EXPECTED_PLAN_HASH" };
    }
    if (!isSha256Hex(confirmTargetDb)) {
      return { ok: false, code: "INVALID_CONFIRM_TARGET_DB" };
    }
  }

  return {
    ok: true,
    options: {
      mode,
      clientsFilePath: clientsFilePath ? resolveClientsFilePath(clientsFilePath) : undefined,
      expectedSourceSha256,
      expectedPlanHash,
      confirmTargetDb,
    },
  };
}
