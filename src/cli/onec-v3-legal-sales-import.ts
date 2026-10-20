#!/usr/bin/env node
import { runLegalSalesImport } from "../onec-sales/run-import";

async function main(): Promise<void> {
  const result = await runLegalSalesImport({ argv: process.argv.slice(2) });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "SUCCESS" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
