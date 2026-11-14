import type { Pool } from "pg";
import { readExistingCatalogPhoto } from "./shared-images";
import { createFtpPhotoSession } from "./ftp-image";
import { loadSnapshot } from "./repository";
import { safeImagePath, type Product } from "./model";
import { makeThumbnails, readThumbnail, thumbnailStatus, THUMBNAIL_RECIPE } from "./thumbnails";

/** Explicit one-shot operation. No worker, timer, schedule or import is installed. */
export async function prepareThumbnails(pool: Pool, options: {
  apply: boolean; maxFiles: number; maxRunMs?: number; retryFailed?: boolean;
  readSource?: (path: string) => Promise<Buffer | null>;
  progress?: (value: Record<string, unknown>) => void;
}) {
  if (!Number.isInteger(options.maxFiles) || options.maxFiles < 1 || options.maxFiles > 10000)
    throw new Error("INVALID_LIMIT");
  const db = await pool.connect(), ftp = createFtpPhotoSession();
  const report = { snapshotId: "", total: 0, attempted: 0, prepared: 0, skipped: 0,
    unavailable: 0, previewBytes: 0, visitedAll: false, snapshotChanged: false, storageLimitReached: false };
  let locked = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(718332020) AS ok")).rows[0]?.ok === true;
    if (!locked) throw new Error("THUMBNAIL_PREPARATION_RUNNING");
    const snapshot = await loadSnapshot(db);
    if (!snapshot) throw new Error("CATALOGUE_EMPTY");
    report.snapshotId = snapshot.id;
    const rows = (await db.query<{ record: Product }>(
      "SELECT record FROM internal_catalog_products WHERE snapshot_id=$1 ORDER BY name,guid", [snapshot.id])).rows;
    const paths = [...new Set(rows.flatMap(({ record }) => record.files.map(file => safeImagePath(file.path)))
      .filter((p): p is string => !!p))].sort();
    report.total = paths.length;
    let storageBytes = (await thumbnailStatus(db, snapshot.id)).bytes;
    const started = Date.now();
    for (const relative of paths) {
      if (report.attempted >= options.maxFiles || Date.now() - started >= (options.maxRunMs ?? 45 * 60_000) ||
          ftp.sourceBytes > 8 * 1024 ** 3) return { ...report, status: await thumbnailStatus(db, snapshot.id) };
      const existing = (await db.query<{ status: string; bytes: number }>(
        `SELECT status,coalesce(octet_length(small_bytes)+octet_length(list_bytes),0) AS bytes
         FROM internal_catalog_thumbnails WHERE snapshot_id=$1 AND source_path=$2 AND recipe=$3`,
        [snapshot.id, relative, THUMBNAIL_RECIPE])).rows[0];
      if (existing?.status === "ready" &&
          await readThumbnail(db, snapshot.id, relative, "small") &&
          await readThumbnail(db, snapshot.id, relative, "list")) { report.skipped++; continue; }
      if (existing?.status === "unavailable" && !options.retryFailed) { report.unavailable++; continue; }
      if ((await loadSnapshot(db))?.id !== snapshot.id) {
        report.snapshotChanged = true; return { ...report, status: await thumbnailStatus(db, snapshot.id) };
      }
      report.attempted++;
      const source = options.readSource ? await options.readSource(relative) :
        await readExistingCatalogPhoto(pool, relative) ?? await ftp.read(relative);
      const thumbnails = source ? await makeThumbnails(source) : null;
      // Check again after network/decoding, before publishing any result.
      if ((await loadSnapshot(db))?.id !== snapshot.id) {
        report.snapshotChanged = true; return { ...report, status: await thumbnailStatus(db, snapshot.id) };
      }
      const byteSize = thumbnails ? thumbnails.small.length + thumbnails.list.length : 0;
      if (storageBytes + byteSize - (existing?.bytes ?? 0) > 256 * 1024 * 1024) {
        report.storageLimitReached = true; return { ...report, status: await thumbnailStatus(db, snapshot.id) };
      }
      if (options.apply) await db.query(
        `INSERT INTO internal_catalog_thumbnails(snapshot_id,source_path,recipe,status,
           small_bytes,small_sha256,list_bytes,list_sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(snapshot_id,source_path,recipe) DO UPDATE SET status=EXCLUDED.status,
           small_bytes=EXCLUDED.small_bytes,small_sha256=EXCLUDED.small_sha256,
           list_bytes=EXCLUDED.list_bytes,list_sha256=EXCLUDED.list_sha256,prepared_at=NOW()`,
        [snapshot.id, relative, THUMBNAIL_RECIPE, thumbnails ? "ready" : "unavailable",
          thumbnails?.small ?? null, thumbnails?.smallHash ?? null, thumbnails?.list ?? null, thumbnails?.listHash ?? null]);
      storageBytes += byteSize - (existing?.bytes ?? 0);
      if (thumbnails) {
        report.prepared++; report.previewBytes += thumbnails.small.length + thumbnails.list.length;
      } else report.unavailable++;
      if (report.attempted % 25 === 0) options.progress?.({ ...report });
    }
    report.visitedAll = true;
    return { ...report, status: await thumbnailStatus(db, snapshot.id) };
  } finally {
    ftp.close();
    try { if (locked) await db.query("SELECT pg_advisory_unlock(718332020)"); }
    finally { db.release(); }
  }
}
