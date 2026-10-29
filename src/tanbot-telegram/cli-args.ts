export const TANBOT_TELEGRAM_PROBE_ARGUMENT_ERROR_CODES = [
  "UNKNOWN_ARGUMENT",
  "UNEXPECTED_POSITIONAL",
] as const;

export type TanbotTelegramProbeArgumentErrorCode =
  (typeof TANBOT_TELEGRAM_PROBE_ARGUMENT_ERROR_CODES)[number];

export type TanbotTelegramProbeCliOptions = {
  live: boolean;
};

export type TanbotTelegramProbeCliParseResult =
  | { ok: true; options: TanbotTelegramProbeCliOptions }
  | { ok: false; code: TanbotTelegramProbeArgumentErrorCode };

export const TANBOT_TELEGRAM_PROBE_ARGUMENT_ERROR_MESSAGES: Record<
  TanbotTelegramProbeArgumentErrorCode,
  string
> = {
  UNKNOWN_ARGUMENT: "Unknown CLI argument.",
  UNEXPECTED_POSITIONAL: "Unexpected positional CLI argument.",
};

export function parseTanbotTelegramProbeCliArgs(
  argv: string[],
): TanbotTelegramProbeCliParseResult {
  let live = false;
  for (const arg of argv) {
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, code: "UNKNOWN_ARGUMENT" };
    }
    return { ok: false, code: "UNEXPECTED_POSITIONAL" };
  }
  return { ok: true, options: { live } };
}
