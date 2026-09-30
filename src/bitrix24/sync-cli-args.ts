export const BITRIX24_SYNC_ARGUMENT_ERROR_CODES = [
  "UNKNOWN_ARGUMENT",
  "UNEXPECTED_POSITIONAL",
  "BITRIX_USER_ID_REQUIRED",
  "BITRIX_USER_ID_REQUIRES_VALUE",
  "DUPLICATE_BITRIX_USER_ID",
  "INVALID_BITRIX_USER_ID",
  "INVALID_MAX_PAGES",
  "MAX_PAGES_OUT_OF_RANGE",
] as const;

export type Bitrix24SyncArgumentErrorCode = (typeof BITRIX24_SYNC_ARGUMENT_ERROR_CODES)[number];

export type Bitrix24SyncCliOptions = {
  apply: boolean;
  bitrixUserId: string;
  maxPages?: number;
};

export type Bitrix24SyncCliParseResult =
  | { ok: true; options: Bitrix24SyncCliOptions }
  | { ok: false; code: Bitrix24SyncArgumentErrorCode };

export const BITRIX24_SYNC_MIN_MAX_PAGES = 1;
export const BITRIX24_SYNC_MAX_MAX_PAGES = 100;

export const BITRIX24_SYNC_ARGUMENT_ERROR_MESSAGES: Record<Bitrix24SyncArgumentErrorCode, string> = {
  UNKNOWN_ARGUMENT: "Unknown CLI argument.",
  UNEXPECTED_POSITIONAL: "Unexpected positional CLI argument.",
  BITRIX_USER_ID_REQUIRED: "--bitrix-user-id is required.",
  BITRIX_USER_ID_REQUIRES_VALUE: "--bitrix-user-id requires a value.",
  DUPLICATE_BITRIX_USER_ID: "Duplicate --bitrix-user-id argument.",
  INVALID_BITRIX_USER_ID: "--bitrix-user-id must be a positive integer.",
  INVALID_MAX_PAGES: "--max-pages must be an integer.",
  MAX_PAGES_OUT_OF_RANGE: `--max-pages must be between ${BITRIX24_SYNC_MIN_MAX_PAGES} and ${BITRIX24_SYNC_MAX_MAX_PAGES}.`,
};

export function parseBitrix24SyncCliArgs(argv: string[]): Bitrix24SyncCliParseResult {
  let apply = false;
  let bitrixUserId: string | undefined;
  let bitrixUserIdCount = 0;
  let maxPagesRaw: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
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
    if (arg === "--max-pages") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, code: "INVALID_MAX_PAGES" };
      }
      maxPagesRaw = value.trim();
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

  let maxPages: number | undefined;
  if (maxPagesRaw !== undefined) {
    const parsed = Number(maxPagesRaw);
    if (!Number.isInteger(parsed)) {
      return { ok: false, code: "INVALID_MAX_PAGES" };
    }
    if (parsed < BITRIX24_SYNC_MIN_MAX_PAGES || parsed > BITRIX24_SYNC_MAX_MAX_PAGES) {
      return { ok: false, code: "MAX_PAGES_OUT_OF_RANGE" };
    }
    maxPages = parsed;
  }

  return {
    ok: true,
    options: {
      apply,
      bitrixUserId,
      maxPages,
    },
  };
}
