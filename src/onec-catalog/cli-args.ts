import { DEFAULT_CATALOG_IMPORT_PROFILE, CATALOG_IMPORT_PROFILES } from "./constants";
import { isSha256Hex } from "./manifest";
import type { CatalogImportCliOptions, CatalogImportProfile } from "./types";

export type CliParseResult =
  | { ok: true; options: CatalogImportCliOptions }
  | { ok: false; code: "APPLY_REQUIRES_EXPECTED_SHA256" | "INVALID_ARGUMENTS" };

export const CLI_ARGUMENT_ERROR_MESSAGES: Record<string, string> = {
  APPLY_REQUIRES_EXPECTED_SHA256:
    "Apply mode requires --expected-manifest-sha256 with the manifest SHA-256 from dry-run.",
  INVALID_ARGUMENTS: "Invalid CLI arguments.",
};

function parseProfileValue(raw: string | undefined): CatalogImportProfile | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  return (CATALOG_IMPORT_PROFILES as readonly string[]).includes(normalized)
    ? (normalized as CatalogImportProfile)
    : null;
}

export function parseCatalogImportCliArgs(argv: string[]): CliParseResult {
  let mode: CatalogImportCliOptions["mode"] = "dry_run";
  let profile: CatalogImportProfile = DEFAULT_CATALOG_IMPORT_PROFILE;
  let expectedManifestSha256: string | undefined;
  let localDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--profile=")) {
      const parsedProfile = parseProfileValue(arg.slice("--profile=".length));
      if (!parsedProfile) return { ok: false, code: "INVALID_ARGUMENTS" };
      profile = parsedProfile;
      continue;
    }
    if (arg === "--profile") {
      const parsedProfile = parseProfileValue(argv[i + 1]);
      if (!parsedProfile) return { ok: false, code: "INVALID_ARGUMENTS" };
      profile = parsedProfile;
      i += 1;
      continue;
    }
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
      profile,
      expectedManifestSha256,
      localDir,
    },
  };
}
