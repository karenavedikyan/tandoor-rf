import {
  getBaselineReplacementExitCode,
  runBaselineReplacementCli,
} from "../onec-clients/run-baseline-replacement";

async function main(): Promise<void> {
  const result = await runBaselineReplacementCli({ argv: process.argv.slice(2) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(getBaselineReplacementExitCode(result));
}

main().catch(() => {
  process.stderr.write("Wholesale baseline replacement failed unexpectedly.\n");
  process.exit(1);
});
