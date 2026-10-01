import { isSha256Hex } from "./manifest";
import type { CatalogImportCliOptions } from "./types";

export type CliParseResult =
  | { ok: true; options: CatalogImportCliOptions }
  | { ok: false; code: "APPLY_REQUIRES_EXPECTED_SHA256" | "INVALID_ARGUMENTS" };

export const CLI_ARGUMENT_ERROR_MESSAGES: Record<string, string> = {
  APPLY_REQUIRES_EXPECTED_SHA256:
    "Apply mode requires --expected-manifest-sha256 with the manifest SHA-256 from dry-run.",
  INVALID_ARGUMENTS: "Invalid CLI arguments.",
};

export function parseCatalogImportCliArgs(argv: string[]): CliParseResult {
  let mode: CatalogImportCliOptions["mode"] = "dry_run";
  let expectedManifestSha256: string | undefined;
  let localDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--dry-run" || arg === "--dry_run") {
      mode = "dry_run";
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
      continue;
    }
    if (arg.startsWith("--expected-manifest-sha256=")) {
      expectedManifestSha256 = arg.slice("--expected-manifest-sha256=".length).trim().toLowerCase();
      continue;
    }
    if (arg === "--expected-manifest-sha256") {
      expectedManifestSha256 = argv[i + 1]?.trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg.startsWith("--local-dir=")) {
      localDir = arg.slice("--local-dir=".length).trim();
      continue;
    }
    if (arg === "--local-dir") {
      localDir = argv[i + 1]?.trim();
      i += 1;
      continue;
    }
    return { ok: false, code: "INVALID_ARGUMENTS" };
  }

  if (mode === "apply") {
    if (!expectedManifestSha256 || !isSha256Hex(expectedManifestSha256)) {
      return { ok: false, code: "APPLY_REQUIRES_EXPECTED_SHA256" };
    }
  }

  return {
    ok: true,
    options: {
      mode,
      expectedManifestSha256,
      localDir,
    },
  };
}
