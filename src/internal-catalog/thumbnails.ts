import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Pool, PoolClient } from "pg";
import { processCatalogReferenceToPreview } from "../catalog/image-storage";
import { safeImagePath } from "./model";
import { CatalogImageDeferred, isImageResourceError } from "../catalog/image-deferred";

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
  } catch (error) {
    if (isImageResourceError(error)) throw new CatalogImageDeferred();
    return null;
  }
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

/** Shared LK/bot lookup: the requested snapshot owns SKU and file membership.
 * History can supply bytes, never links. A current result, including an
 * unavailable or corrupt result, blocks fallback for that exact path. */
export function resolveCatalogThumbnails(single: boolean, size: ThumbnailSize = "list"): string {
  const column = size === "small" ? "small" : "list";
  const limit = size === "small" ? 32768 : 131072;
  return `WITH requested AS MATERIALIZED (
    SELECT p.guid, f, ord, replace(f->>'path',chr(92),'/') AS path
    FROM internal_catalog_products p
    CROSS JOIN LATERAL jsonb_array_elements(p.record->'files') WITH ORDINALITY AS files(f,ord)
    WHERE p.snapshot_id=$1::uuid ${single ? "AND p.guid=$3::uuid AND f->>'guid'=$4" : ""}
  ), verified AS MATERIALIZED (
    SELECT t.snapshot_id, t.source_path, t.prepared_at, t.${column}_sha256 AS media_hash
    FROM (SELECT DISTINCT path FROM requested) r
    JOIN internal_catalog_thumbnails t ON t.source_path=r.path AND t.recipe=$2
    WHERE t.status='ready' AND octet_length(t.${column}_bytes) BETWEEN 1 AND ${limit}
      AND encode(sha256(t.${column}_bytes),'hex')=t.${column}_sha256
  ), resolved AS (
    SELECT DISTINCT ON (r.guid,r.ord) r.*, t.snapshot_id AS media_snapshot,t.media_hash
    FROM requested r
    JOIN verified t ON t.source_path=r.path
    LEFT JOIN internal_catalog_thumbnails current_media ON current_media.snapshot_id=$1::uuid
      AND current_media.source_path=r.path AND current_media.recipe=$2
    WHERE t.snapshot_id=$1::uuid OR (
      current_media.snapshot_id IS NULL AND EXISTS (
        SELECT 1 FROM internal_catalog_products previous
        JOIN internal_catalog_snapshots old_snapshot ON old_snapshot.id=previous.snapshot_id
        JOIN internal_catalog_snapshots wanted_snapshot ON wanted_snapshot.id=$1::uuid
        WHERE previous.snapshot_id=t.snapshot_id AND previous.guid=r.guid
          AND old_snapshot.imported_at <= wanted_snapshot.imported_at
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(previous.record->'files') AS old(f)
            WHERE old.f->>'guid'=r.f->>'guid' AND replace(old.f->>'path',chr(92),'/')=r.path
          )
      )
    )
    ORDER BY r.guid,r.ord,(t.snapshot_id=$1::uuid) DESC,t.prepared_at DESC,t.snapshot_id DESC
  )`;
}

export async function readCatalogThumbnail(
  db: Database, snapshotId: string, productGuid: string, fileGuid: string, size: ThumbnailSize,
) {
  const column = size === "small" ? "small" : "list";
  const media = await db.query<{ bytes: Buffer }>(`${resolveCatalogThumbnails(true, size)}
    SELECT t.${column}_bytes AS bytes FROM resolved r JOIN internal_catalog_thumbnails t
      ON t.snapshot_id=r.media_snapshot AND t.source_path=r.path AND t.recipe=$2
    ORDER BY r.ord LIMIT 1`,
  [snapshotId, THUMBNAIL_RECIPE, productGuid, fileGuid]);
  return media.rows[0]?.bytes ?? null;
}

export async function catalogHasPreparedPhotos(db: Database, snapshotId: string) {
  try {
    const result = await db.query(`${resolveCatalogThumbnails(false)} SELECT 1 FROM resolved LIMIT 1`,
      [snapshotId, THUMBNAIL_RECIPE]);
    return result.rows.length > 0;
  } catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
    return false;
  }
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
