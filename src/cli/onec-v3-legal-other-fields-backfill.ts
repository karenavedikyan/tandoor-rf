#!/usr/bin/env node
import { runLegalOtherFieldsBackfill } from "../onec-exchange-v3/legal-other-fields-backfill/run-backfill";

async function main(): Promise<void> {
  const result = await runLegalOtherFieldsBackfill({ argv: process.argv.slice(2) });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "SUCCESS" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
