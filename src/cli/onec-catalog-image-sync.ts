import type { PoolClient } from "pg";
import { getPool } from "../db/pool";
import { runCatalogImageSync, type CatalogImageSyncReport } from "../catalog/image-sync";
import { sanitizeImageSyncErrorMessage } from "../catalog/image-storage";

function resolveStatus(report: CatalogImageSyncReport): "success" | "partial" | "failed" {
  if (report.errors.length && report.filesPrepared === 0 && report.filesRestored === 0 && report.filesSkipped === 0) {
    return "failed";
  }
  if (report.errors.length || report.stoppedByLimit) {
    return "partial";
  }
  return "success";
}

async function finalizeRun(
  client: PoolClient,
  runId: string,
  status: string,
  report: CatalogImageSyncReport,
  errorCode: string | null = null,
): Promise<void> {
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
          error_code = $8,
          report = $9::jsonb
      WHERE id = $1::uuid
    `,
    [
      runId,
      status,
      report.filesSeen,
      report.filesPrepared + report.filesRestored,
      report.filesFailed,
      report.filesSkipped,
      report.sourceBytesRead + report.previewBytesWritten,
      errorCode,
      JSON.stringify(report),
    ],
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const pool = getPool();
  if (!pool) {
    console.error(JSON.stringify({ ok: false, complete: false, error: "Database unavailable." }));
    process.exit(1);
  }

  const client = await pool.connect();
  let runId: string | null = null;
  let report: CatalogImageSyncReport | null = null;

  try {
    const runInsert = await client.query<{ id: string }>(
      `
        INSERT INTO onec_catalog_image_sync_runs (mode, status, source_kind)
        VALUES ($1, 'running', 'local_dir')
        RETURNING id::text AS id
      `,
      [apply ? "apply" : "dry_run"],
    );
    runId = runInsert.rows[0]!.id;
    report = await runCatalogImageSync(client, { apply });
    const status = resolveStatus(report);
    await finalizeRun(client, runId, status, report);
    console.log(
      JSON.stringify({
        ok: status !== "failed",
        complete: report.queueComplete,
        runId,
        status,
        ...report,
      }),
    );
    process.exit(status === "failed" ? 1 : 0);
  } catch (error) {
    const message = sanitizeImageSyncErrorMessage(error);
    if (runId && report) {
      await finalizeRun(client, runId, "failed", report, "SYNC_EXCEPTION");
    } else if (runId) {
      await client.query(
        `
          UPDATE onec_catalog_image_sync_runs
          SET finished_at = NOW(), status = 'failed', error_code = 'SYNC_EXCEPTION',
              report = $2::jsonb
          WHERE id = $1::uuid
        `,
        [runId, JSON.stringify({ error: message })],
      );
    }
    console.error(JSON.stringify({ ok: false, complete: false, runId, error: message }));
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, complete: false, error: sanitizeImageSyncErrorMessage(error) }));
  process.exit(1);
});
