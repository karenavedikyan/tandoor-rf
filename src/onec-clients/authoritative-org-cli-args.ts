import { isAbsolute, resolve } from "node:path";
import { isSha256Hex } from "./sha256";

export type AuthoritativeOrgCliOptions = {
  mode: "dry_run" | "apply";
  employeeRosterPath: string;
  expectedRosterSha256?: string;
  confirmTargetDb?: string;
};

export type AuthoritativeOrgCliParseResult =
  | { ok: true; options: AuthoritativeOrgCliOptions }
  | {
      ok: false;
      code:
        | "UNKNOWN_ARGUMENT"
        | "EMPLOYEE_ROSTER_REQUIRED"
        | "APPLY_REQUIRES_EXPECTED_ROSTER_SHA256"
        | "APPLY_REQUIRES_CONFIRM_TARGET_DB"
        | "INVALID_EXPECTED_ROSTER_SHA256"
        | "INVALID_CONFIRM_TARGET_DB"
        | "APPLY_AND_DRY_RUN";
    };

export const AUTHORITATIVE_ORG_CLI_ERRORS: Record<string, string> = {
  UNKNOWN_ARGUMENT: "Unknown CLI argument.",
  EMPLOYEE_ROSTER_REQUIRED: "--employee-roster requires a file path.",
  APPLY_REQUIRES_EXPECTED_ROSTER_SHA256:
    "Apply requires --expected-roster-sha256 from a verified dry-run of the same file.",
  APPLY_REQUIRES_CONFIRM_TARGET_DB: "Apply requires --confirm-target-db from dry-run target DB identity.",
  INVALID_EXPECTED_ROSTER_SHA256: "--expected-roster-sha256 must be a 64-character hex SHA-256.",
  INVALID_CONFIRM_TARGET_DB: "--confirm-target-db must be a 64-character hex target DB fingerprint.",
  APPLY_AND_DRY_RUN: "Use either --apply or --dry-run, not both.",
};

export function resolveAuthoritativeOrgRosterPath(filePath: string, cwd = process.cwd()): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

export function parseAuthoritativeOrgCliArgs(argv: string[]): AuthoritativeOrgCliParseResult {
  let mode: AuthoritativeOrgCliOptions["mode"] = "dry_run";
  let employeeRosterPath: string | undefined;
  let expectedRosterSha256: string | undefined;
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
    if (arg === "--employee-roster") {
      employeeRosterPath = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg === "--expected-roster-sha256") {
      expectedRosterSha256 = argv[index + 1]?.trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--confirm-target-db") {
      confirmTargetDb = argv[index + 1]?.trim().toLowerCase();
      index += 1;
      continue;
    }
    return { ok: false, code: "UNKNOWN_ARGUMENT" };
  }

  if (sawDryRun && sawApply) {
    return { ok: false, code: "APPLY_AND_DRY_RUN" };
  }
  if (!employeeRosterPath) {
    return { ok: false, code: "EMPLOYEE_ROSTER_REQUIRED" };
  }
  if (mode === "apply") {
    if (!expectedRosterSha256) {
      return { ok: false, code: "APPLY_REQUIRES_EXPECTED_ROSTER_SHA256" };
    }
    if (!isSha256Hex(expectedRosterSha256)) {
      return { ok: false, code: "INVALID_EXPECTED_ROSTER_SHA256" };
    }
    if (!confirmTargetDb) {
      return { ok: false, code: "APPLY_REQUIRES_CONFIRM_TARGET_DB" };
    }
    if (!isSha256Hex(confirmTargetDb)) {
      return { ok: false, code: "INVALID_CONFIRM_TARGET_DB" };
    }
  }

  return {
    ok: true,
    options: {
      mode,
      employeeRosterPath,
      expectedRosterSha256,
      confirmTargetDb,
    },
  };
}
