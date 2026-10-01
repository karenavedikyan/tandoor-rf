import { getCatalogImportExitCode, runCatalogImport } from "../onec-catalog/run-import";

async function main(): Promise<void> {
  const result = await runCatalogImport({ argv: process.argv.slice(2) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(getCatalogImportExitCode(result.status));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected catalog import failure.";
  process.stdout.write(
    `${JSON.stringify({ status: "DATABASE_ERROR", mode: "dry_run", message, durationMs: 0 }, null, 2)}\n`,
  );
  process.exit(1);
});
