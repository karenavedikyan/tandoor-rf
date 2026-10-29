import { closePool, getPool } from "../db/pool";
import { loadTanbotMaxStage2Config } from "../tanbot-max/stage2-config";
import { runTanbotMaxOutboxWorkerOnce } from "../tanbot-max/outbox-scheduler";

async function main(): Promise<void> {
  const loaded = loadTanbotMaxStage2Config();
  if (!loaded.ok) {
    process.stderr.write(`${loaded.message}\n`);
    process.exit(2);
  }
  const pool = getPool();
  if (!pool) {
    process.stderr.write("Database pool unavailable.\n");
    process.exit(2);
  }
  await runTanbotMaxOutboxWorkerOnce(pool, loaded.config);
  await closePool();
}

void main().catch((err) => {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
