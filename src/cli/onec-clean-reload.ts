import {
  getCleanReloadExitCode,
  runCleanReloadCli,
} from "../onec-clean-reload/run-clean-reload";

async function main(): Promise<void> {
  const result = await runCleanReloadCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(getCleanReloadExitCode(result));
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      code: "UNEXPECTED",
      message: error instanceof Error ? error.message : "Clean reload failed unexpectedly.",
    }),
  );
  process.stderr.write("\n");
  process.exit(1);
});
