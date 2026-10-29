export type TanbotMaxProbeCliOptions = {
  live: boolean;
  tlsProbe: boolean;
};

export type TanbotMaxProbeCliParseResult =
  | { ok: true; options: TanbotMaxProbeCliOptions }
  | { ok: false; code: "UNKNOWN_ARGUMENT" | "UNEXPECTED_POSITIONAL" };

export function parseTanbotMaxProbeCliArgs(argv: string[]): TanbotMaxProbeCliParseResult {
  let live = false;
  let tlsProbe = false;
  for (const arg of argv) {
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (arg === "--tls-probe") {
      tlsProbe = true;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, code: "UNKNOWN_ARGUMENT" };
    }
    return { ok: false, code: "UNEXPECTED_POSITIONAL" };
  }
  return { ok: true, options: { live, tlsProbe } };
}
