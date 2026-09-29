import { getPool } from "../db/pool";
import { runOneImportJob } from "../onec-import/worker";

async function main(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    process.stderr.write("DATABASE_URL is required to process import jobs.\n");
    process.exit(1);
  }
  const status = await runOneImportJob(pool);
  process.stdout.write(`${status}\n`);
  process.exit(status === "failed" ? 1 : 0);
}

main().catch(() => {
  process.stderr.write("1C import job worker failed unexpectedly.\n");
  process.exit(1);
});
