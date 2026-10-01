import { getPool } from "../db/pool";
import { runCatalogImageSync } from "../catalog/image-sync";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const pool = getPool();
  if (!pool) {
    console.error(JSON.stringify({ ok: false, error: "Database unavailable." }));
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    const runInsert = await client.query<{ id: string }>(
      `
        INSERT INTO onec_catalog_image_sync_runs (mode, status, source_kind)
        VALUES ($1, 'running', 'local_dir')
        RETURNING id::text AS id
      `,
      [apply ? "apply" : "dry_run"],
    );
    const runId = runInsert.rows[0]!.id;
    const report = await runCatalogImageSync(client, { apply });
    const status =
      report.errors.length && report.filesPrepared === 0 && report.filesSkipped === 0
        ? "failed"
        : report.errors.length
          ? "partial"
          : "success";
    await client.query(
      `
        UPDATE onec_catalog_image_sync_runs
        SET finished_at = NOW(),
            status = $2,
            files_seen = $3,
            files_prepared = $4,
            files_failed = $5,
            files_skipped = $6,
            bytes_processed = $7,
            report = $8::jsonb
        WHERE id = $1::uuid
      `,
      [
        runId,
        status,
        report.filesSeen,
        report.filesPrepared,
        report.filesFailed,
        report.filesSkipped,
        report.bytesProcessed,
        JSON.stringify(report),
      ],
    );
    console.log(JSON.stringify({ ok: true, runId, status, ...report }));
    process.exit(status === "failed" ? 1 : 0);
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }));
  process.exit(1);
});
