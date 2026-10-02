import { createHash, randomUUID } from "node:crypto";
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

export type StoredPreviewVerification =
  | { ok: true; byteSize: number }
  | { ok: false; message: string };

const SHA256_HEX = /^[a-f0-9]{64}$/;
const ALLOWED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);

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
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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

export function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isValidSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

export async function resolveSafeStorageRoot(storageDir: string): Promise<string | null> {
  const root = path.resolve(storageDir);
  let stat;
  try {
    stat = await fs.lstat(root);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return null;
  }

  const previewsPath = path.join(realRoot, "previews");
  try {
    const previewsStat = await fs.lstat(previewsPath);
    if (previewsStat.isSymbolicLink()) {
      const realPreviews = await fs.realpath(previewsPath);
      if (!isPathInsideRoot(realPreviews, realRoot)) return null;
    } else if (previewsStat.isDirectory()) {
      const realPreviews = await fs.realpath(previewsPath);
      if (!isPathInsideRoot(realPreviews, realRoot)) return null;
    } else {
      return null;
    }
  } catch {
    // previews dir may not exist yet
  }

  return realRoot;
}

export async function resolveSafeStoragePath(
  storageDir: string,
  relativePath: string,
): Promise<string | null> {
  const normalized = normalizeCatalogRelativePath(relativePath);
  if (!normalized) return null;
  const root = await resolveSafeStorageRoot(storageDir);
  if (!root) return null;

  const candidate = path.resolve(root, normalized);
  if (!isPathInsideRoot(candidate, root)) return null;

  let current = root;
  for (const segment of normalized.split(path.sep)) {
    current = path.join(current, segment);
    const resolved = path.resolve(current);
    if (!isPathInsideRoot(resolved, root)) return null;
    try {
      const segmentStat = await fs.lstat(resolved);
      if (segmentStat.isSymbolicLink()) {
        const realSegment = await fs.realpath(resolved);
        if (!isPathInsideRoot(realSegment, root)) return null;
      }
    } catch {
      // segment may not exist yet
    }
  }

  return candidate;
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
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("Invalid read limit.");
  }
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

async function withSharpTimeout<T>(
  createPipeline: () => sharp.Sharp,
  operation: (pipeline: sharp.Sharp) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const pipeline = createPipeline();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(pipeline),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          pipeline.destroy();
          reject(new Error("Image processing timeout."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isAllowedImageMetadata(metadata: sharp.Metadata): boolean {
  const format = metadata.format?.toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_FORMATS.has(format)) {
    return false;
  }
  if ((metadata.pages ?? 1) > 1) {
    return false;
  }
  return true;
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
    const metadata = await withSharpTimeout(
      () => sharp(sourceBuffer, { failOn: "error", limitInputPixels: maxPixels }),
      (pipeline) => pipeline.metadata(),
      timeoutMs,
    );
    if (!isAllowedImageMetadata(metadata)) {
      return { ok: false, message: "Unsupported or animated image." };
    }
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

    const previewBuffer = await withSharpTimeout(
      () => sharp(sourceBuffer, { failOn: "error", limitInputPixels: maxPixels }),
      (pipeline) =>
        pipeline
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
  const root = await resolveSafeStorageRoot(storageDir);
  if (!root) {
    throw new Error("Unsafe storage directory.");
  }
  const previewsDir = path.join(root, "previews");
  if (!isPathInsideRoot(previewsDir, root)) {
    throw new Error("Unsafe storage directory.");
  }
  await fs.mkdir(previewsDir, { recursive: true });
  const previewsStat = await fs.lstat(previewsDir);
  if (!previewsStat.isDirectory() || previewsStat.isSymbolicLink()) {
    throw new Error("Unsafe storage directory.");
  }
  const realPreviews = await fs.realpath(previewsDir);
  if (!isPathInsideRoot(realPreviews, root)) {
    throw new Error("Unsafe storage directory.");
  }
}

export function buildImmutablePreviewRelativePath(contentSha256: string): string {
  const subdir = contentSha256.slice(0, 2);
  return path.join("previews", subdir, `${contentSha256}.webp`);
}

export function buildImmutablePreviewPath(storageDir: string, contentSha256: string): string {
  return path.join(storageDir, buildImmutablePreviewRelativePath(contentSha256));
}

export async function verifyStoredPreview(
  storagePath: string,
  expectedSha256: string,
): Promise<StoredPreviewVerification> {
  if (!isValidSha256Hex(expectedSha256)) {
    return { ok: false, message: "Invalid preview hash." };
  }
  let stat;
  try {
    stat = await fs.lstat(storagePath);
  } catch {
    return { ok: false, message: "Stored preview missing." };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { ok: false, message: "Stored preview unavailable." };
  }
  if (stat.size <= 0) {
    return { ok: false, message: "Stored preview empty." };
  }

  let buffer: Buffer;
  try {
    buffer = await readBoundedFile(storagePath, getMaxImageBytes());
  } catch {
    return { ok: false, message: "Stored preview unreadable." };
  }

  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  if (actualSha256 !== expectedSha256) {
    return { ok: false, message: "Stored preview hash mismatch." };
  }

  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.format || metadata.format !== "webp") {
      return { ok: false, message: "Stored preview format invalid." };
    }
  } catch {
    return { ok: false, message: "Stored preview corrupted." };
  }

  return { ok: true, byteSize: buffer.length };
}

/** Writes preview atomically after pre-validating storage layout. */
export async function writeImmutablePreview(
  storageDir: string,
  contentSha256: string,
  previewBuffer: Buffer,
): Promise<string> {
  if (!isValidSha256Hex(contentSha256)) {
    throw new Error("Invalid preview hash.");
  }
  const actualSha256 = createHash("sha256").update(previewBuffer).digest("hex");
  if (actualSha256 !== contentSha256) {
    throw new Error("Preview buffer hash mismatch.");
  }

  const relativePath = buildImmutablePreviewRelativePath(contentSha256);
  const target = await resolveSafeStoragePath(storageDir, relativePath);
  if (!target) {
    throw new Error("Unsafe storage path.");
  }

  const existing = await verifyStoredPreview(target, contentSha256);
  if (existing.ok) {
    return target;
  }

  const targetDir = path.dirname(target);
  const safeDir = await resolveSafeStoragePath(storageDir, path.join("previews", contentSha256.slice(0, 2)));
  if (!safeDir || safeDir !== targetDir) {
    throw new Error("Unsafe storage path.");
  }
  await fs.mkdir(targetDir, { recursive: true });

  const tempPath = path.join(targetDir, `.tmp-${randomUUID()}.webp`);
  if (!isPathInsideRoot(tempPath, (await resolveSafeStorageRoot(storageDir))!)) {
    throw new Error("Unsafe storage path.");
  }

  try {
    await fs.writeFile(tempPath, previewBuffer, { flag: "wx" });
    const verified = await verifyStoredPreview(tempPath, contentSha256);
    if (!verified.ok) {
      throw new Error(verified.message);
    }
    try {
      await fs.rename(tempPath, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        await fs.rm(tempPath, { force: true });
        const raced = await verifyStoredPreview(target, contentSha256);
        if (raced.ok) return target;
        throw new Error("Stored preview hash mismatch.");
      }
      throw error;
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const final = await verifyStoredPreview(target, contentSha256);
  if (!final.ok) {
    throw new Error(final.message);
  }
  return target;
}

export async function readStoredImage(storagePath: string, storageDir?: string): Promise<Buffer> {
  if (storageDir) {
    const root = await resolveSafeStorageRoot(storageDir);
    if (!root) {
      throw new Error("Stored image unavailable.");
    }
    const resolved = path.resolve(storagePath);
    if (!isPathInsideRoot(resolved, root)) {
      throw new Error("Stored image unavailable.");
    }
    const realResolved = await fs.realpath(resolved).catch(() => null);
    if (!realResolved || !isPathInsideRoot(realResolved, root)) {
      throw new Error("Stored image unavailable.");
    }
  }

  const stat = await fs.lstat(storagePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Stored image unavailable.");
  }
  return readBoundedFile(storagePath, getMaxImageBytes());
}

export function sanitizeImageSyncErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Image sync failed.";
  return raw
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, "[path]")
    .replace(/[A-Za-z]:\\(?:[\w.-]+\\)+[\w.-]+/g, "[path]")
    .slice(0, 240);
}
