export type RegularUpdateCliOptions = {
  mode: "dry_run" | "apply";
  expectedFingerprint?: string;
};

export type RegularUpdateCliParseResult =
  | { ok: true; options: RegularUpdateCliOptions }
  | { ok: false; code: "APPLY_REQUIRES_EXPECTED_FINGERPRINT" | "UNKNOWN_ARGUMENT" };

export const REGULAR_UPDATE_CLI_ERRORS = {
  APPLY_REQUIRES_EXPECTED_FINGERPRINT:
    "Apply mode requires --expected-fingerprint from a verified dry-run of the same bundle.",
  UNKNOWN_ARGUMENT: "Unknown argument.",
} as const;

export function parseRegularUpdateCliArgs(argv: string[]): RegularUpdateCliParseResult {
  let mode: RegularUpdateCliOptions["mode"] = "dry_run";
  let expectedFingerprint: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      mode = "dry_run";
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
      continue;
    }
    if (arg === "--expected-fingerprint") {
      expectedFingerprint = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    return { ok: false, code: "UNKNOWN_ARGUMENT" };
  }

  if (mode === "apply" && !expectedFingerprint) {
    return { ok: false, code: "APPLY_REQUIRES_EXPECTED_FINGERPRINT" };
  }

  return { ok: true, options: { mode, expectedFingerprint } };
}
