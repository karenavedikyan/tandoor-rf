import {
  TANBOT_TELEGRAM_PROBE_ARGUMENT_ERROR_MESSAGES,
  parseTanbotTelegramProbeCliArgs,
} from "../tanbot-telegram/cli-args";
import { getTanbotTelegramProbeExitCode, runTanbotTelegramProbe } from "../tanbot-telegram/probe";
import { formatDiagnosticReportForCli } from "../tanbot-telegram/sanitize";

async function main(): Promise<void> {
  const parsed = parseTanbotTelegramProbeCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${TANBOT_TELEGRAM_PROBE_ARGUMENT_ERROR_MESSAGES[parsed.code]}\n`);
    process.exit(2);
  }

  const report = await runTanbotTelegramProbe({ live: parsed.options.live });
  process.stdout.write(formatDiagnosticReportForCli(report));
  process.exit(getTanbotTelegramProbeExitCode(report.status));
}

main().catch(() => {
  process.stderr.write("Tanbot Telegram probe failed unexpectedly.\n");
  process.exit(1);
});
