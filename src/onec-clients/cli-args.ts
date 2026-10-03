import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  DEFAULT_HOLDING_LINK_VALIDATION_POLICY,
  isHoldingLinkValidationPolicy,
  type HoldingLinkValidationPolicy,
} from "./holding-link-policy";
import { isSha256Hex } from "./sha256";
import type { ClientsImportCliOptions } from "./types";

export const CLI_ARGUMENT_ERROR_CODES = [
  "UNKNOWN_ARGUMENT",
  "UNEXPECTED_POSITIONAL",
  "EXPECTED_SHA256_REQUIRES_VALUE",
  "DUPLICATE_EXPECTED_SHA256",
  "APPLY_REQUIRES_EXPECTED_SHA256",
  "INVALID_EXPECTED_SHA256",
  "APPLY_AND_DRY_RUN",
  "EXPECTED_SHA256_WITHOUT_APPLY",
  "HOLDING_LINK_POLICY_REQUIRES_VALUE",
  "INVALID_HOLDING_LINK_POLICY",
  "DUPLICATE_HOLDING_LINK_POLICY",
  "EMPLOYEE_ROSTER_REQUIRES_VALUE",
  "DUPLICATE_EMPLOYEE_ROSTER",
  "EMPLOYEE_ROSTER_UNREADABLE",
] as const;

export type CliArgumentErrorCode = (typeof CLI_ARGUMENT_ERROR_CODES)[number];

export type CliArgsParseResult =
  | { ok: true; options: ClientsImportCliOptions }
  | { ok: false; code: CliArgumentErrorCode };

export const CLI_ARGUMENT_ERROR_MESSAGES: Record<CliArgumentErrorCode, string> = {
  UNKNOWN_ARGUMENT: "Unknown CLI argument.",
  UNEXPECTED_POSITIONAL: "Unexpected positional CLI argument.",
  EXPECTED_SHA256_REQUIRES_VALUE: "--expected-sha256 requires a value.",
  DUPLICATE_EXPECTED_SHA256: "Duplicate --expected-sha256 argument.",
  APPLY_REQUIRES_EXPECTED_SHA256: "--apply requires --expected-sha256.",
  INVALID_EXPECTED_SHA256: "--expected-sha256 must be a 64-character hex SHA-256 hash.",
  APPLY_AND_DRY_RUN: "Use either --apply or --dry-run, not both.",
  EXPECTED_SHA256_WITHOUT_APPLY: "--expected-sha256 is only valid with --apply.",
  HOLDING_LINK_POLICY_REQUIRES_VALUE: "--holding-link-policy requires a value.",
  INVALID_HOLDING_LINK_POLICY: "--holding-link-policy must be tolerant or strict.",
  DUPLICATE_HOLDING_LINK_POLICY: "Duplicate --holding-link-policy argument.",
  EMPLOYEE_ROSTER_REQUIRES_VALUE: "--employee-roster requires a file path.",
  DUPLICATE_EMPLOYEE_ROSTER: "Duplicate --employee-roster argument.",
  EMPLOYEE_ROSTER_UNREADABLE: "--employee-roster file could not be read.",
};

function readOptionalFlagValue(argv: string[], index: number, flag: string): string | null {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }
  return value;
}

export function readEmployeeRosterFileBytes(filePath: string, cwd = process.cwd()): Buffer | null {
  const resolved = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  try {
    return readFileSync(resolved);
  } catch {
    return null;
  }
}

export function parseClientsImportCliArgs(argv: string[]): CliArgsParseResult {
  let dryRun = false;
  let apply = false;
  let expectedSha256: string | undefined;
  let expectedSha256Count = 0;
  let holdingLinkValidationPolicy: HoldingLinkValidationPolicy = DEFAULT_HOLDING_LINK_VALIDATION_POLICY;
  let holdingLinkPolicyCount = 0;
  let wholesaleCompositionPrep = false;
  let employeeRosterFile: string | undefined;
  let employeeRosterCount = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--wholesale-composition-prep") {
      wholesaleCompositionPrep = true;
      continue;
    }
    if (arg === "--expected-sha256") {
      expectedSha256Count += 1;
      if (expectedSha256Count > 1) {
        return { ok: false, code: "DUPLICATE_EXPECTED_SHA256" };
      }
      const value = readOptionalFlagValue(argv, index, arg);
      if (!value) {
        return { ok: false, code: "EXPECTED_SHA256_REQUIRES_VALUE" };
      }
      expectedSha256 = value.trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--holding-link-policy") {
      holdingLinkPolicyCount += 1;
      if (holdingLinkPolicyCount > 1) {
        return { ok: false, code: "DUPLICATE_HOLDING_LINK_POLICY" };
      }
      const value = readOptionalFlagValue(argv, index, arg);
      if (!value) {
        return { ok: false, code: "HOLDING_LINK_POLICY_REQUIRES_VALUE" };
      }
      const normalized = value.trim().toLowerCase();
      if (!isHoldingLinkValidationPolicy(normalized)) {
        return { ok: false, code: "INVALID_HOLDING_LINK_POLICY" };
      }
      holdingLinkValidationPolicy = normalized;
      index += 1;
      continue;
    }
    if (arg === "--employee-roster") {
      employeeRosterCount += 1;
      if (employeeRosterCount > 1) {
        return { ok: false, code: "DUPLICATE_EMPLOYEE_ROSTER" };
      }
      const value = readOptionalFlagValue(argv, index, arg);
      if (!value) {
        return { ok: false, code: "EMPLOYEE_ROSTER_REQUIRES_VALUE" };
      }
      employeeRosterFile = value.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, code: "UNKNOWN_ARGUMENT" };
    }
    return { ok: false, code: "UNEXPECTED_POSITIONAL" };
  }

  if (apply && dryRun) {
    return { ok: false, code: "APPLY_AND_DRY_RUN" };
  }

  if (apply) {
    if (!expectedSha256) {
      return { ok: false, code: "APPLY_REQUIRES_EXPECTED_SHA256" };
    }
    if (!isSha256Hex(expectedSha256)) {
      return { ok: false, code: "INVALID_EXPECTED_SHA256" };
    }
    return {
      ok: true,
      options: {
        mode: "apply",
        expectedSha256,
        holdingLinkValidationPolicy,
        wholesaleCompositionPrep,
        employeeRosterFile,
      },
    };
  }

  if (expectedSha256 && !apply) {
    return { ok: false, code: "EXPECTED_SHA256_WITHOUT_APPLY" };
  }

  return {
    ok: true,
    options: {
      mode: "dry_run",
      holdingLinkValidationPolicy,
      wholesaleCompositionPrep,
      employeeRosterFile,
    },
  };
}
