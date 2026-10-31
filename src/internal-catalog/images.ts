import path from "node:path";
import { realpath } from "node:fs/promises";
import { getMaxImageBytes, processImageToPreview, readBoundedFile, resolveSafeSourcePath } from "../catalog/image-storage";
import { safeImagePath, type SourceFile } from "./model";

/** Separate opt-in source: never implicitly attach the existing XML catalogue's files. */
export function internalCatalogImagesConfigured(): boolean {
  const root = process.env.INTERNAL_CATALOG_IMAGE_SOURCE_DIR?.trim();
  return !!root && path.isAbsolute(root);
}

/** Read-only; filenames come from a validated snapshot, never from an HTTP path. */
export async function readInternalCatalogImage(file: SourceFile): Promise<Buffer | null> {
  if (!internalCatalogImagesConfigured()) return null;
  const relative = safeImagePath(file.path);
  if (!relative) return null;
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
