import { runMigrations } from "../db/migrate-runner";

async function main(): Promise<void> {
  const applied = await runMigrations();
  if (applied.length === 0) {
    console.log("No pending migrations.");
    return;
  }
  console.log(`Applied migrations: ${applied.join(", ")}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exit(1);
});
