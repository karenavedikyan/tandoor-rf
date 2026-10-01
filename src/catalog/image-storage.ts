import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export type ImageValidationResult =
  | {
      ok: true;
      mimeType: string;
      byteSize: number;
      width: number;
      height: number;
      contentSha256: string;
      previewBuffer: Buffer;
    }
  | { ok: false; message: string };

export function getCatalogImageStorageDir(): string | null {
  const configured = process.env.CATALOG_IMAGE_STORAGE_DIR?.trim();
  return configured || null;
}

export function getCatalogImageSourceDir(): string | null {
  const configured = process.env.CATALOG_IMAGE_SOURCE_DIR?.trim();
  return configured || null;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMaxImageBytes(): number {
  return parsePositiveInt(process.env.CATALOG_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
}

export function getMaxImagePixels(): number {
  return parsePositiveInt(process.env.CATALOG_IMAGE_MAX_PIXELS, 24_000_000);
}

export function getMaxImageDimension(): number {
  return parsePositiveInt(process.env.CATALOG_IMAGE_MAX_DIMENSION, 4096);
}

export function getPreviewMaxDimension(): number {
  return parsePositiveInt(process.env.CATALOG_IMAGE_PREVIEW_MAX, 1200);
}

export function getImageProcessTimeoutMs(): number {
  return parsePositiveInt(process.env.CATALOG_IMAGE_PROCESS_TIMEOUT_MS, 10_000);
}

export function isRemoteOrAbsoluteSourcePath(sourcePath: string): boolean {
  const trimmed = sourcePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

export function normalizeCatalogRelativePath(sourcePath: string): string | null {
  const trimmed = sourcePath.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("\0")) return null;
  const segments = trimmed.split(/[/\\]+/).filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "..")) return null;
  return segments.join(path.sep);
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveSafeSourcePath(
  sourceDir: string,
  sourcePath: string,
): Promise<string | null> {
  if (isRemoteOrAbsoluteSourcePath(sourcePath)) return null;
  const normalized = normalizeCatalogRelativePath(sourcePath);
  if (!normalized) return null;

  const root = path.resolve(sourceDir);
  const candidate = path.resolve(root, normalized);
  if (!isPathInsideRoot(candidate, root)) return null;

  let stat;
  try {
    stat = await fs.lstat(candidate);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return null;

  let realPath: string;
  try {
    realPath = await fs.realpath(candidate);
  } catch {
    return null;
  }
  if (!isPathInsideRoot(realPath, root)) return null;

  const realStat = await fs.lstat(realPath);
  if (!realStat.isFile() || realStat.isSymbolicLink()) return null;
  return realPath;
}

export async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error("Source is not a regular file.");
    }
    if (stat.size <= 0) {
      throw new Error("Empty file.");
    }
    if (stat.size > maxBytes) {
      throw new Error("Image exceeds size limit.");
    }
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
    if (bytesRead !== stat.size) {
      throw new Error("Incomplete file read.");
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

async function withProcessingTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Image processing timeout.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function processImageToPreview(sourceBuffer: Buffer): Promise<ImageValidationResult> {
  if (sourceBuffer.length === 0) return { ok: false, message: "Empty file." };
  const maxBytes = getMaxImageBytes();
  if (sourceBuffer.length > maxBytes) return { ok: false, message: "Image exceeds size limit." };

  const maxPixels = getMaxImagePixels();
  const maxDimension = getMaxImageDimension();
  const previewMax = getPreviewMaxDimension();
  const timeoutMs = getImageProcessTimeoutMs();

  try {
    const metadata = await withProcessingTimeout(
      sharp(sourceBuffer, { failOn: "error", limitInputPixels: maxPixels }).metadata(),
      timeoutMs,
    );
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) {
      return { ok: false, message: "Unable to decode image dimensions." };
    }
    if (width > maxDimension || height > maxDimension) {
      return { ok: false, message: "Image dimensions exceed limit." };
    }
    if (width * height > maxPixels) {
      return { ok: false, message: "Image pixel count exceeds limit." };
    }

    const previewBuffer = await withProcessingTimeout(
      sharp(sourceBuffer, { failOn: "error", limitInputPixels: maxPixels })
        .rotate()
        .resize({
          width: previewMax,
          height: previewMax,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer(),
      timeoutMs,
    );

    if (!previewBuffer.length) {
      return { ok: false, message: "Preview generation failed." };
    }

    const contentSha256 = createHash("sha256").update(previewBuffer).digest("hex");
    return {
      ok: true,
      mimeType: "image/webp",
      byteSize: previewBuffer.length,
      width,
      height,
      contentSha256,
      previewBuffer,
    };
  } catch {
    return { ok: false, message: "Unsupported or corrupted image." };
  }
}

export async function ensureStorageDir(storageDir: string): Promise<void> {
  await fs.mkdir(path.join(storageDir, "previews"), { recursive: true });
}

export function buildImmutablePreviewPath(storageDir: string, contentSha256: string): string {
  const subdir = contentSha256.slice(0, 2);
  return path.join(storageDir, "previews", subdir, `${contentSha256}.webp`);
}

/** Writes preview once; existing immutable object is reused on conflict. */
export async function writeImmutablePreview(
  storageDir: string,
  contentSha256: string,
  previewBuffer: Buffer,
): Promise<string> {
  const target = buildImmutablePreviewPath(storageDir, contentSha256);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, previewBuffer, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
  }
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Unsafe storage path.");
  }
  const realTarget = await fs.realpath(target);
  const realRoot = await fs.realpath(storageDir);
  if (!isPathInsideRoot(realTarget, realRoot)) {
    throw new Error("Unsafe storage path.");
  }
  return realTarget;
}

export async function readStoredImage(storagePath: string): Promise<Buffer> {
  const stat = await fs.lstat(storagePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Stored image unavailable.");
  }
  return readBoundedFile(storagePath, getMaxImageBytes());
}
