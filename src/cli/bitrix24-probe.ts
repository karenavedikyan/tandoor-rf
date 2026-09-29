import {
  BITRIX24_PROBE_ARGUMENT_ERROR_MESSAGES,
  parseBitrix24ProbeCliArgs,
} from "../bitrix24/cli-args";
import { getBitrix24ProbeExitCode, runBitrix24Probe } from "../bitrix24/probe";
import { formatProbeReportForCli } from "../bitrix24/sanitize";

async function main(): Promise<void> {
  const parsed = parseBitrix24ProbeCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${BITRIX24_PROBE_ARGUMENT_ERROR_MESSAGES[parsed.code]}\n`);
    process.exit(1);
  }

  const result = await runBitrix24Probe({
    live: parsed.options.live,
    bitrixUserId: parsed.options.bitrixUserId,
  });
  process.stdout.write(formatProbeReportForCli(result));
  process.exit(getBitrix24ProbeExitCode(result.status));
}

main().catch(() => {
  process.stderr.write("Bitrix24 probe failed unexpectedly.\n");
  process.exit(1);
});
