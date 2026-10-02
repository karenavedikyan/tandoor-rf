import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { Client } from "basic-ftp";
import { getPool } from "../db/pool";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { runCatalogImageSync } from "../catalog/image-sync";
import { getMaxImageBytes, isRemoteOrAbsoluteSourcePath, normalizeCatalogRelativePath, verifyStoredPreview } from "../catalog/image-storage";
import { s3Enabled } from "../catalog/image-s3";

export function safePhotoRelativePath(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value) || isRemoteOrAbsoluteSourcePath(value)) throw new Error("Unsafe photo path.");
  const normalized = normalizeCatalogRelativePath(value);
  if (!normalized || normalized.split("/").some((s) => s === ".")) throw new Error("Unsafe photo path.");
  return normalized;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const missingOnly = process.argv.includes("--missing-only");
  const rawLimit = process.argv.find((a) => a.startsWith("--max-files="))?.split("=")[1] ?? "10";
  const limit = Number(rawLimit);
  if (!/^[1-9]\d*$/.test(rawLimit) || limit > 5000) throw new Error("Invalid file limit.");
  if (!s3Enabled()) throw new Error("FTP photo loader requires private S3 storage.");
  const config = loadOnecFtpConfig();
  if (!config.ok) throw new Error("FTP configuration unavailable.");
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable.");
  const db = await pool.connect();
  const ftp = new Client(30000);
  let temp: string | undefined;
  let runId: string | undefined;
  const report = { attempted: 0, prepared: 0, skipped: 0, failed: 0, sourceBytes: 0, previewBytes: 0,
    complete: false, errors: [] as Array<{ sourcePath: string; message: string }> };
  let lock = false;
  try {
    lock = (await db.query("SELECT pg_try_advisory_lock(718332019) AS ok")).rows[0].ok;
    if (!lock) throw new Error("Another FTP photo loader is running.");
    const catalog = await db.query<{ version: string; image_path: string; storage_path: string | null; content_sha256: string | null; status: string | null }>(
      `SELECT DISTINCT i.version_id::text AS version, i.image_path, a.storage_path,a.content_sha256,a.status
       FROM onec_catalog_product_images i JOIN onec_catalog_state s ON s.active_version_id=i.version_id
       LEFT JOIN onec_catalog_image_assets a ON a.source_path=i.image_path ORDER BY i.image_path`);
    runId = (await db.query(`INSERT INTO onec_catalog_image_sync_runs(mode,status,source_kind)
      VALUES($1,'running','ftp') RETURNING id`, [apply ? "apply" : "dry_run"])).rows[0].id;
    const c = config.config;
    await ftp.access({ host: c.host, port: c.port, user: c.user, password: c.password, secure: false });
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "tandoor-photos-"));
    process.env.CATALOG_IMAGE_SOURCE_DIR = temp;
    const started = Date.now();
    for (let i = 0; i < catalog.rows.length; i++) {
      const row = catalog.rows[i]!;
      if (missingOnly && row.status === "ready" && row.storage_path && row.content_sha256 &&
          (await verifyStoredPreview(row.storage_path, row.content_sha256)).ok) {
        report.skipped++; continue;
      }
      if (report.attempted >= limit || Date.now() - started > 45 * 60 * 1000 ||
          report.sourceBytes >= 8 * 1024 ** 3) break;
      if (ftp.closed) await ftp.access({ host: c.host, port: c.port, user: c.user, password: c.password, secure: false });
      const active = (await db.query("SELECT active_version_id::text AS version FROM onec_catalog_state")).rows[0]?.version;
      if (active !== row.version) throw new Error("Active catalog changed; photo load stopped.");
      report.attempted++;
      let local: string | undefined;
      try {
        const relative = safePhotoRelativePath(row.image_path);
        const remote = `/s3/IMG/${relative}`;
        const bytes = await ftp.size(remote);
        if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > getMaxImageBytes()) throw new Error("Source size outside limit.");
        const chunks: Buffer[] = [];
        let seen = 0;
        await ftp.downloadTo(new Writable({ write(chunk, _encoding, done) {
          seen += chunk.length;
          if (seen > bytes || seen > getMaxImageBytes()) { done(new Error("Source size changed.")); return; }
          chunks.push(Buffer.from(chunk)); done();
        } }), remote);
        report.sourceBytes += seen;
        if (seen !== bytes) throw new Error("Incomplete FTP image.");
        local = path.join(temp, relative);
        await fs.mkdir(path.dirname(local), { recursive: true });
        await fs.writeFile(local, Buffer.concat(chunks), { flag: "wx", mode: 0o600 });
        const result = await runCatalogImageSync(db, { apply, sourcePaths: [row.image_path],
          maxFiles: 1, maxBytes: 4 * getMaxImageBytes(), maxRunMs: 120000 });
        report.prepared += result.filesPrepared + result.filesRestored;
        report.skipped += result.filesSkipped;
        report.failed += result.filesFailed;
        report.previewBytes += result.previewBytesWritten;
        report.errors.push(...result.errors);
        if (result.errors.length && !result.filesFailed) report.failed++;
      } catch (e) {
        report.failed++;
        const code = (e as { code?: string | number }).code;
        report.errors.push({ sourcePath: row.image_path,
          message: code === 550 ? "FTP image unavailable (550)." : "Photo transfer or validation failed." });
      } finally { if (local) await fs.rm(local, { force: true }); }
      if (i % 25 === 0) console.log(JSON.stringify({ progress: true, runId,
        attempted: report.attempted, prepared: report.prepared, failed: report.failed }));
    }
    report.complete = report.attempted + report.skipped >= catalog.rows.length && report.failed === 0;
  } finally {
    ftp.close();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
    if (runId) {
      await db.query(`UPDATE onec_catalog_image_sync_runs SET finished_at=NOW(),status=$2,
        files_seen=$3,files_prepared=$4,files_failed=$5,files_skipped=$6,bytes_processed=$7,report=$8::jsonb WHERE id=$1`,
      [runId, report.complete ? "success" : (report.prepared || report.skipped ? "partial" : "failed"),
        report.attempted,report.prepared,report.failed,report.skipped,report.sourceBytes+report.previewBytes,JSON.stringify(report)]);
      console.log(JSON.stringify({ runId, apply, ...report }));
    }
    if (lock) await db.query("SELECT pg_advisory_unlock(718332019)");
    db.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(() => {
  console.error(JSON.stringify({ ok: false, message: "Photo load stopped. See run journal; secrets suppressed." }));
  process.exitCode = 1;
});
