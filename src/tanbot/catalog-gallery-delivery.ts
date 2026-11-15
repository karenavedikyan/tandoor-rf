import type { PoolClient } from "pg";
import { catalogPhotoBytes, type CatalogPhoto } from "./catalog";
import { catalogJpeg } from "./catalog-media";

type GalleryResult = (
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string; retryable?: boolean }
) & { uploadedImageToken?: string };
type Progress = { sent: number; imageToken?: string };

/** Called only under the existing per-reply advisory lock. One bounded image
 * in memory at a time; every acknowledged send is persisted immediately.
 * Existing retry workers continue a long/interrupted series, without new jobs.
 */
export async function deliverCatalogGallery(input: {
  client: PoolClient;
  photos: CatalogPhoto[];
  extra: Record<string, unknown>;
  persist: (extra: Record<string, unknown>) => Promise<unknown>;
  send: (bytes: Buffer | null, last: boolean, imageToken?: string) => Promise<GalleryResult>;
  now?: () => number;
}): Promise<GalleryResult> {
  const raw = input.extra.catalogGalleryProgress;
  const progress = raw && typeof raw === "object" ? raw as Partial<Progress> : {};
  const sent = progress.sent ?? 0;
  if (!Number.isSafeInteger(sent) || sent < 0 || sent > input.photos.length) {
    return { ok: false, code: "CATALOG_GALLERY_PROGRESS", message: "Invalid gallery progress.", retryable: false };
  }
  let imageToken = typeof progress.imageToken === "string" &&
    progress.imageToken.length <= 8192 ? progress.imageToken : undefined;
  const extra = { ...input.extra }, now = input.now ?? Date.now, started = now();
  for (let i = sent; i < input.photos.length; i++) {
    if (i > sent && now() - started >= 20000) {
      return { ok: false, code: "CATALOG_GALLERY_PENDING", message: "Gallery continues on retry.", retryable: true };
    }
    // Recheck current snapshot, category and exact SKU/file on every send/retry.
    const stored = await catalogPhotoBytes(input.client, input.photos[i]);
    const bytes = stored ? await catalogJpeg(stored) : null;
    const result = await input.send(bytes, i === input.photos.length - 1, bytes ? imageToken : undefined);
    if (!result.ok) {
      if (result.uploadedImageToken) {
        extra.catalogGalleryProgress = { sent: i, imageToken: result.uploadedImageToken };
        await input.persist(extra);
      }
      return result;
    }
    imageToken = undefined;
    extra.catalogGalleryProgress = { sent: i + 1 };
    await input.persist(extra);
  }
  return { ok: true, result: {} };
}
