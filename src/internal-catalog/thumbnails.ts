import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Pool, PoolClient } from "pg";
import { processCatalogReferenceToPreview } from "../catalog/image-storage";
import { safeImagePath } from "./model";

// Change the recipe when encoding parameters change; never silently reuse old bytes.
export const THUMBNAIL_RECIPE = "webp-v1-240-640-q76";
export type ThumbnailSize = "small" | "list";
type Database = Pool | PoolClient;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Decode/validate with the existing byte/pixel/format guards before deriving media. */
export async function makeThumbnails(source: Buffer) {
  const validated = await processCatalogReferenceToPreview(source);
  if (!validated.ok) return null;
  const encode = (edge: number) => sharp(validated.previewBuffer, { failOn: "error" })
    .timeout({ seconds: 10 }).rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 76 }).toBuffer();
  try {
    const small = await encode(240), list = await encode(640);
    if (!small.length || small.length > 32768 || !list.length || list.length > 131072) return null;
    return { small, list, smallHash: hash(small), listHash: hash(list) };
  } catch { return null; }
}

/** Caller must authorize and bind the file to the requested product/snapshot first.
 * No FTP, decoding, jobs or writes are triggered by viewing a thumbnail.
 */
export async function readThumbnail(db: Database, snapshotId: string, sourcePath: string, size: ThumbnailSize) {
  const relative = safeImagePath(sourcePath);
  if (!relative) return null;
  // Column choice is an internal enum, never interpolated from an HTTP parameter.
  const column = size === "small" ? "small" : "list";
  const { rows } = await db.query<{ bytes: Buffer; sha256: string }>(
    `SELECT ${column}_bytes AS bytes,${column}_sha256 AS sha256 FROM internal_catalog_thumbnails
     WHERE snapshot_id=$1 AND source_path=$2 AND recipe=$3 AND status='ready'`,
    [snapshotId, relative, THUMBNAIL_RECIPE]);
  const row = rows[0], limit = size === "small" ? 32768 : 131072;
  return row && Buffer.isBuffer(row.bytes) && row.bytes.length > 0 && row.bytes.length <= limit &&
    hash(row.bytes) === row.sha256 ? row.bytes : null;
}

export async function thumbnailStatus(db: Database, snapshotId: string) {
  try {
    const { rows } = await db.query<{ total: number; ready: number; unavailable: number; bytes: string }>(
      `WITH paths AS (
         SELECT DISTINCT replace(f->>'path',chr(92),'/') AS path
         FROM internal_catalog_products p CROSS JOIN LATERAL jsonb_array_elements(p.record->'files') f
         WHERE p.snapshot_id=$1
       )
       SELECT count(*)::int AS total,count(*) FILTER (WHERE t.status='ready')::int AS ready,
         count(*) FILTER (WHERE t.status='unavailable')::int AS unavailable,
         coalesce(sum(octet_length(t.small_bytes)+octet_length(t.list_bytes)),0)::text AS bytes
       FROM paths p LEFT JOIN internal_catalog_thumbnails t
         ON t.snapshot_id=$1 AND t.source_path=p.path AND t.recipe=$2`,
      [snapshotId, THUMBNAIL_RECIPE]);
    const row = rows[0]!;
    return { total: row.total, ready: row.ready, unavailable: row.unavailable, bytes: Number(row.bytes),
      // Keep the old photo route until the first full pass finishes. Missing source
      // images are explicit results, not a reason to block every available thumbnail.
      enabled: row.total > 0 && row.ready > 0 && row.ready + row.unavailable === row.total };
  } catch (error) {
    // The reviewed additive migration may be applied after the code deploy.
    // Never replace a functioning photo route with a failing metadata request.
    if ((error as { code?: string }).code !== "42P01") throw error;
    return { total: 0, ready: 0, unavailable: 0, bytes: 0, enabled: false };
  }
}
