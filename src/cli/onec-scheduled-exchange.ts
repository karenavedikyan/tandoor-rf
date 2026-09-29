import { runScheduledExchangeCycle } from "../onec-scheduled-exchange/run-cycle";

async function main(): Promise<void> {
  const result = await runScheduledExchangeCycle();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const exitCode =
    result.status === "SUCCESS" ||
    result.status === "CHECK_ONLY" ||
    result.status === "SKIPPED_UNCHANGED" ||
    result.status === "APPLY_DISABLED"
      ? 0
      : 1;
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Scheduled exchange failed.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
