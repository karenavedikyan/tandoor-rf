import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type ImageValidationResult =
  | {
      ok: true;
      mimeType: string;
      byteSize: number;
      width: number | null;
      height: number | null;
      contentSha256: string;
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

export function resolveStoragePath(storageDir: string, sourcePath: string): string {
  const normalized = sourcePath.replace(/^\/+/, "").replace(/\.\./g, "");
  return path.join(storageDir, normalized);
}

export function resolveSourcePath(sourceDir: string, sourcePath: string): string | null {
  const normalized = sourcePath.replace(/^\/+/, "").replace(/\.\./g, "");
  const absolute = path.resolve(sourceDir, normalized);
  const root = path.resolve(sourceDir);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    return null;
  }
  return absolute;
}

function detectMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 6 && (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")) {
    return "image/gif";
  }
  return null;
}

export async function validateImageBytes(buffer: Buffer): Promise<ImageValidationResult> {
  if (buffer.length === 0) return { ok: false, message: "Empty file." };
  const maxBytes = Number(process.env.CATALOG_IMAGE_MAX_BYTES ?? String(8 * 1024 * 1024));
  if (buffer.length > maxBytes) return { ok: false, message: "Image exceeds size limit." };
  const mimeType = detectMime(buffer);
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    return { ok: false, message: "Unsupported image format." };
  }
  const contentSha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    ok: true,
    mimeType,
    byteSize: buffer.length,
    width: null,
    height: null,
    contentSha256,
  };
}

export async function ensureStorageDir(storageDir: string): Promise<void> {
  await fs.mkdir(storageDir, { recursive: true });
}

export async function writeImageToStorage(
  storageDir: string,
  sourcePath: string,
  buffer: Buffer,
): Promise<string> {
  const target = resolveStoragePath(storageDir, sourcePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return target;
}

export async function readStoredImage(storagePath: string): Promise<Buffer> {
  return fs.readFile(storagePath);
}
