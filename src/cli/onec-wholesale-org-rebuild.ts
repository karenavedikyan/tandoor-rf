#!/usr/bin/env node
import { runAuthoritativeWholesaleOrgRebuild } from "../onec-clients/run-authoritative-org-rebuild";

async function main(): Promise<void> {
  const result = await runAuthoritativeWholesaleOrgRebuild({ argv: process.argv.slice(2) });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "SUCCESS" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
