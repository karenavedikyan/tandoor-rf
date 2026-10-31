import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { getCatalogImageStorageDir, processImageToPreview, readStoredImage } from "../catalog/image-storage";
import { safeImagePath } from "./model";

/** Authorization and snapshot/file binding MUST be checked by the caller first. */
export async function readExistingCatalogPhoto(pool: Pool, relative: string): Promise<Buffer | null> {
  const normalized = safeImagePath(relative);
  if (!normalized) return null;
  try {
    const root = getCatalogImageStorageDir();
    if (!root) return null;
    const { rows } = await pool.query<{ storage_path: string; content_sha256: string; mime_type: string }>(
      `SELECT storage_path, content_sha256, mime_type FROM onec_catalog_image_assets
       WHERE source_path = ANY($1::text[]) AND status = 'ready'
       ORDER BY source_path LIMIT 2`,
      [[normalized, normalized.replace(/\//g, "\\")]],
    );
    for (const row of rows) {
      if (row.mime_type !== "image/webp" || !/^[a-f0-9]{64}$/.test(row.content_sha256)) continue;
      // readStoredImage enforces the configured local root or private S3 key.
      if (root.startsWith("s3://") !== row.storage_path.startsWith("s3://")) continue;
      const bytes = await readStoredImage(row.storage_path, root);
      if (createHash("sha256").update(bytes).digest("hex") !== row.content_sha256) continue;
      const preview = await processImageToPreview(bytes);
      if (preview.ok) return preview.previewBuffer;
    }
  } catch { /* Missing/unavailable storage is eligible for the read-only FTP fallback. */ }
  return null;
}

type Read = () => Promise<Buffer | null>;
type Entry = { bytes: Buffer | null; expires: number };

/** Per-process bounded preview cache; not a durable import, job, or disk cache. */
export function createPhotoCache(options: {
  maxBytes?: number; maxEntries?: number; concurrency?: number; maxPending?: number;
  ttlMs?: number; negativeTtlMs?: number; waitMs?: number; now?: () => number;
} = {}) {
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 64;
  const now = options.now ?? Date.now;
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<Buffer | null>>();
  const queue: Array<() => void> = [];
  let active = 0, used = 0;
  async function execute(read: Read): Promise<Buffer | null> {
    if (active >= (options.concurrency ?? 2)) {
      const admitted = await new Promise<boolean>(resolve => {
        const start = () => { clearTimeout(timer); active++; resolve(true); };
        const timer = setTimeout(() => {
          const index = queue.indexOf(start);
          if (index >= 0) queue.splice(index, 1);
          resolve(false);
        }, options.waitMs ?? 20_000);
        queue.push(start);
      });
      if (!admitted) return null;
    } else active++;
    try { return await read(); }
    catch { return null; }
    finally { active--; queue.shift()?.(); }
  }
  return async (key: string, read: Read): Promise<Buffer | null> => {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) {
      cache.delete(key); cache.set(key, hit);
      return hit.bytes;
    }
    if (hit) { used -= hit.bytes?.length ?? 0; cache.delete(key); }
    const underway = pending.get(key);
    if (underway) return underway;
    if (pending.size >= (options.maxPending ?? 64)) return null;
    const operation = execute(read).then(bytes => {
      if (!bytes || bytes.length <= maxBytes) {
        cache.set(key, { bytes, expires: now() + (bytes ? options.ttlMs ?? 300_000 : options.negativeTtlMs ?? 15_000) });
        used += bytes?.length ?? 0;
        while (used > maxBytes || cache.size > maxEntries) {
          const oldest = cache.keys().next().value!;
          used -= cache.get(oldest)!.bytes?.length ?? 0;
          cache.delete(oldest);
        }
      }
      return bytes;
    }).finally(() => { pending.delete(key); });
    pending.set(key, operation);
    return operation;
  };
}
