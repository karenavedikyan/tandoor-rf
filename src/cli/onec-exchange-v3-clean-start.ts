#!/usr/bin/env node
/**
 * Controlled legacy purge for exchange v3. Requires --confirm-database-url and --i-understand.
 * Does not run on application startup.
 */
import { requirePool } from "../db/pool";
import { runExchangeV3CleanStartPurge } from "../onec-exchange-v3/clean-start-purge";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmUrl = args.find((a) => a.startsWith("--confirm-database-url="))?.split("=")[1];
  const dryRun = args.includes("--dry-run");
  const understood = args.includes("--i-understand");

  const activeUrl = process.env.DATABASE_URL?.trim();
  if (!understood) {
    console.error("Refusing: pass --i-understand");
    process.exit(2);
  }
  if (!confirmUrl || !activeUrl || confirmUrl !== activeUrl) {
    console.error("Refusing: --confirm-database-url must match DATABASE_URL");
    process.exit(2);
  }
  if (activeUrl.includes("tandoor_rf") && !activeUrl.includes("_test")) {
    console.error("Refusing: production-like DATABASE_URL");
    process.exit(2);
  }

  const pool = requirePool();
  const client = await pool.connect();
  try {
    if (dryRun) {
      await client.query("BEGIN");
    }
    const report = await runExchangeV3CleanStartPurge(client);
    if (dryRun) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ dryRun: true, report }, null, 2));
    } else {
      await client.query("COMMIT");
      console.log(JSON.stringify({ dryRun: false, report }, null, 2));
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
