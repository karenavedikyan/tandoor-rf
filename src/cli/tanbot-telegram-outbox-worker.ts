import { getPool } from "../db/pool";
import { loadTanbotTelegramStage2Config } from "../tanbot-telegram/stage2-config";
import { runTanbotOutboxWorkerOnce } from "../tanbot-telegram/outbox-scheduler";

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const loaded = loadTanbotTelegramStage2Config();
  if (!loaded.ok) {
    process.stderr.write(`${loaded.message}\n`);
    process.exit(2);
  }
  const pool = getPool();
  if (!pool) {
    process.stderr.write("Database unavailable.\n");
    process.exit(2);
  }
  if (once) {
    await runTanbotOutboxWorkerOnce(pool, loaded.config);
    process.exit(0);
  }
  process.stderr.write("Use --once for a single outbox tick (worker loop is started by the HTTP server when enabled).\n");
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
