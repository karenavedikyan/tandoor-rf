import { resetDatabase } from "../../test/helpers/test-db";
import { assertTanTrackerUserTestDatabaseUrl } from "../../src/shared/tan-tracker-user-test-env";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  assertTanTrackerUserTestDatabaseUrl(databaseUrl, "reset");
  await resetDatabase(databaseUrl);
  console.log("RESET_OK: schema dropped — run seed to repopulate");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
