export const BITRIX24_PROBE_ARGUMENT_ERROR_CODES = [
  "UNKNOWN_ARGUMENT",
  "UNEXPECTED_POSITIONAL",
  "LIVE_REQUIRES_BITRIX_USER_ID",
  "BITRIX_USER_ID_REQUIRES_VALUE",
  "DUPLICATE_BITRIX_USER_ID",
  "INVALID_BITRIX_USER_ID",
] as const;

export type Bitrix24ProbeArgumentErrorCode =
  (typeof BITRIX24_PROBE_ARGUMENT_ERROR_CODES)[number];

export type Bitrix24ProbeCliOptions = {
  live: boolean;
  bitrixUserId?: string;
};

export type Bitrix24ProbeCliParseResult =
  | { ok: true; options: Bitrix24ProbeCliOptions }
  | { ok: false; code: Bitrix24ProbeArgumentErrorCode };

export const BITRIX24_PROBE_ARGUMENT_ERROR_MESSAGES: Record<
  Bitrix24ProbeArgumentErrorCode,
  string
> = {
  UNKNOWN_ARGUMENT: "Unknown CLI argument.",
  UNEXPECTED_POSITIONAL: "Unexpected positional CLI argument.",
  LIVE_REQUIRES_BITRIX_USER_ID: "--live requires --bitrix-user-id.",
  BITRIX_USER_ID_REQUIRES_VALUE: "--bitrix-user-id requires a value.",
  DUPLICATE_BITRIX_USER_ID: "Duplicate --bitrix-user-id argument.",
  INVALID_BITRIX_USER_ID: "--bitrix-user-id must be a positive integer.",
};

export function parseBitrix24ProbeCliArgs(argv: string[]): Bitrix24ProbeCliParseResult {
  let live = false;
  let bitrixUserId: string | undefined;
  let bitrixUserIdCount = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") {
      live = true;
      continue;
    }
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

  if (live && !bitrixUserId) {
    return { ok: false, code: "LIVE_REQUIRES_BITRIX_USER_ID" };
  }
  if (bitrixUserId && !/^\d+$/.test(bitrixUserId)) {
    return { ok: false, code: "INVALID_BITRIX_USER_ID" };
  }
  if (bitrixUserId === "0") {
    return { ok: false, code: "INVALID_BITRIX_USER_ID" };
  }

  return {
    ok: true,
    options: {
      live,
      bitrixUserId,
    },
  };
}
