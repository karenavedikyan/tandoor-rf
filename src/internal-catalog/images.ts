import path from "node:path";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { getMaxImageBytes, processImageToPreview, readBoundedFile, resolveSafeSourcePath } from "../catalog/image-storage";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { createPhotoCache, readExistingCatalogPhoto } from "./shared-images";
import { readFtpPhoto } from "./ftp-image";
import { safeImagePath, type SourceFile } from "./model";

const cachedPhoto = createPhotoCache();

/** Existing credentials are reused only with an explicit opt-in for this catalogue. */
export function internalCatalogImagesConfigured(): boolean {
  if (process.env.INTERNAL_CATALOG_IMAGE_BACKEND === "shared") {
    return !!process.env.CATALOG_IMAGE_STORAGE_DIR?.trim() ||
      process.env.CATALOG_IMAGE_STORAGE_BACKEND === "s3" || loadOnecFtpConfig().ok;
  }
  const root = process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR?.trim();
  return !!root && path.isAbsolute(root);
}

/** Read-only; filenames come from a validated snapshot, never from an HTTP path. */
export async function readInternalCatalogImage(file: SourceFile, pool?: Pool, version = ""): Promise<Buffer | null> {
  if (!internalCatalogImagesConfigured()) return null;
  const relative = safeImagePath(file.path);
  if (!relative) return null;
  if (process.env.INTERNAL_CATALOG_IMAGE_BACKEND === "shared") {
    // Hash source settings to isolate cached bytes after a source/credential change.
    // Neither settings nor this opaque key are returned or logged.
    const scope = createHash("sha256").update(JSON.stringify([
      loadOnecFtpConfig(), process.env.CATALOG_IMAGE_STORAGE_DIR,
      process.env.CATALOG_IMAGE_STORAGE_BACKEND, process.env.CATALOG_IMAGE_S3_ENDPOINT,
      process.env.CATALOG_IMAGE_S3_BUCKET, process.env.CATALOG_IMAGE_S3_ACCESS_KEY,
      process.env.CATALOG_IMAGE_S3_SECRET_KEY,
    ])).digest("hex");
    return cachedPhoto(`${scope}:${version}:${relative}`, async () =>
      (pool ? await readExistingCatalogPhoto(pool, relative) : null) ?? await readFtpPhoto(relative));
  }
  try {
    const root = await realpath(process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR!.trim());
    const source = await resolveSafeSourcePath(root, relative);
    if (!source) return null;
    const bytes = await readBoundedFile(source, getMaxImageBytes());
    const preview = await processImageToPreview(bytes);
    return preview.ok ? preview.previewBuffer : null;
  } catch {
    // Do not disclose private filesystem paths, decoder errors or file existence.
    return null;
  }
}
