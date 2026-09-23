import { isSha256Hex } from "./sha256";
import type { ClientsImportCliOptions } from "./types";

export type CliArgsParseResult =
  | { ok: true; options: ClientsImportCliOptions }
  | { ok: false; message: string };

export function parseClientsImportCliArgs(argv: string[]): CliArgsParseResult {
  let dryRun = false;
  let apply = false;
  let expectedSha256: string | undefined;

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
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, message: "--expected-sha256 requires a value." };
      }
      expectedSha256 = value.trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${arg}` };
    }
    return { ok: false, message: `Unexpected positional argument: ${arg}` };
  }

  if (apply && dryRun) {
    return { ok: false, message: "Use either --apply or --dry-run, not both." };
  }

  if (apply) {
    if (!expectedSha256) {
      return { ok: false, message: "--apply requires --expected-sha256." };
    }
    if (!isSha256Hex(expectedSha256)) {
      return { ok: false, message: "--expected-sha256 must be a 64-character hex SHA-256 hash." };
    }
    return { ok: true, options: { mode: "apply", expectedSha256 } };
  }

  if (expectedSha256 && !apply) {
    return { ok: false, message: "--expected-sha256 is only valid with --apply." };
  }

  return { ok: true, options: { mode: "dry_run" } };
}
