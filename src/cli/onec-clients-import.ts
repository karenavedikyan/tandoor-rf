import { getImportExitCode, runClientsImport } from "../onec-clients/run-import";

const LEGACY_DISABLED = process.env.ONEC_ALLOW_LEGACY_CLIENTS_IMPORT === "true";

async function main(): Promise<void> {
  if (!LEGACY_DISABLED) {
    process.stderr.write(
      "Legacy 2-file clients import is disabled. Use: node --import tsx src/cli/onec-regular-update.ts (exchange v3, 4 files).\n",
    );
    process.exit(2);
  }
  const result = await runClientsImport({ argv: process.argv.slice(2) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(getImportExitCode(result.status));
}

main().catch(() => {
  process.stderr.write("1C clients import failed unexpectedly.\n");
  process.exit(1);
});
