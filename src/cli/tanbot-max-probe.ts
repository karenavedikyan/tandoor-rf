import {
  parseTanbotMaxProbeCliArgs,
  type TanbotMaxProbeCliParseResult,
} from "../tanbot-max/cli-args";
import { getTanbotMaxProbeExitCode, runTanbotMaxProbe } from "../tanbot-max/probe";
import { formatDiagnosticReportForCli } from "../tanbot-max/sanitize";

function printArgumentError(result: Extract<TanbotMaxProbeCliParseResult, { ok: false }>): void {
  process.stderr.write(`Invalid arguments: ${result.code}\n`);
}

async function main(): Promise<void> {
  const parsed = parseTanbotMaxProbeCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    printArgumentError(parsed);
    process.exit(2);
  }
  const report = await runTanbotMaxProbe({
    live: parsed.options.live,
    tlsProbe: parsed.options.tlsProbe,
  });
  process.stdout.write(formatDiagnosticReportForCli(report));
  process.exit(getTanbotMaxProbeExitCode(report.status));
}

void main();
