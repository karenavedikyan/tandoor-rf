import { getRegularUpdateExitCode, runRegularUpdate } from "../onec-regular-update/run-update";

async function main(): Promise<void> {
  const result = await runRegularUpdate();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(getRegularUpdateExitCode(result));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Regular update failed.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
