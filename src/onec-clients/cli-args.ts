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
};

export function parseClientsImportCliArgs(argv: string[]): CliArgsParseResult {
  let dryRun = false;
  let apply = false;
  let expectedSha256: string | undefined;
  let expectedSha256Count = 0;

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
    if (arg === "--expected-sha256") {
      expectedSha256Count += 1;
      if (expectedSha256Count > 1) {
        return { ok: false, code: "DUPLICATE_EXPECTED_SHA256" };
      }
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, code: "EXPECTED_SHA256_REQUIRES_VALUE" };
      }
      expectedSha256 = value.trim().toLowerCase();
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
    return { ok: true, options: { mode: "apply", expectedSha256 } };
  }

  if (expectedSha256 && !apply) {
    return { ok: false, code: "EXPECTED_SHA256_WITHOUT_APPLY" };
  }

  return { ok: true, options: { mode: "dry_run" } };
}
