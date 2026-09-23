import { getImportExitCode, runClientsImport } from "../onec-clients/run-import";

async function main(): Promise<void> {
  const result = await runClientsImport({ argv: process.argv.slice(2) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(getImportExitCode(result.status));
}

main().catch(() => {
  process.stderr.write("1C clients import failed unexpectedly.\n");
  process.exit(1);
});
