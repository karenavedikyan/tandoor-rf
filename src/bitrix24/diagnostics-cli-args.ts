export const BITRIX24_DIAGNOSTICS_ARGUMENT_ERROR_CODES = [
  "UNKNOWN_ARGUMENT",
  "UNEXPECTED_POSITIONAL",
  "BITRIX_USER_ID_REQUIRED",
  "BITRIX_USER_ID_REQUIRES_VALUE",
  "DUPLICATE_BITRIX_USER_ID",
  "INVALID_BITRIX_USER_ID",
] as const;

export type Bitrix24DiagnosticsArgumentErrorCode =
  (typeof BITRIX24_DIAGNOSTICS_ARGUMENT_ERROR_CODES)[number];

export type Bitrix24DiagnosticsCliOptions = {
  bitrixUserId: string;
};

export type Bitrix24DiagnosticsCliParseResult =
  | { ok: true; options: Bitrix24DiagnosticsCliOptions }
  | { ok: false; code: Bitrix24DiagnosticsArgumentErrorCode };

export const BITRIX24_DIAGNOSTICS_ARGUMENT_ERROR_MESSAGES: Record<
  Bitrix24DiagnosticsArgumentErrorCode,
  string
> = {
  UNKNOWN_ARGUMENT: "Unknown CLI argument.",
  UNEXPECTED_POSITIONAL: "Unexpected positional CLI argument.",
  BITRIX_USER_ID_REQUIRED: "--bitrix-user-id is required.",
  BITRIX_USER_ID_REQUIRES_VALUE: "--bitrix-user-id requires a value.",
  DUPLICATE_BITRIX_USER_ID: "Duplicate --bitrix-user-id argument.",
  INVALID_BITRIX_USER_ID: "--bitrix-user-id must be a positive integer.",
};

export function parseBitrix24DiagnosticsCliArgs(
  argv: string[],
): Bitrix24DiagnosticsCliParseResult {
  let bitrixUserId: string | undefined;
  let bitrixUserIdCount = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bitrix-user-id") {
      bitrixUserIdCount += 1;
      if (bitrixUserIdCount > 1) {
        return { ok: false, code: "DUPLICATE_BITRIX_USER_ID" };
      }
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, code: "BITRIX_USER_ID_REQUIRES_VALUE" };
      }
      bitrixUserId = value.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, code: "UNKNOWN_ARGUMENT" };
    }
    return { ok: false, code: "UNEXPECTED_POSITIONAL" };
  }

  if (!bitrixUserId) {
    return { ok: false, code: "BITRIX_USER_ID_REQUIRED" };
  }
  if (!/^\d+$/.test(bitrixUserId) || bitrixUserId === "0") {
    return { ok: false, code: "INVALID_BITRIX_USER_ID" };
  }

  return {
    ok: true,
    options: {
      bitrixUserId,
    },
  };
}
