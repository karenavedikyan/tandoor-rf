import sharp from "sharp";
import type { Pool, PoolClient } from "pg";
import { deleteAttachmentBytes, readAttachmentBytes, writeAttachmentBytes } from "./attachment-storage";

export function isSafeInlinePreviewMime(mime: string): boolean {
  const m = String(mime ?? "").toLowerCase();
  return m === "image/jpeg" || m === "image/png" || m === "image/webp";
}

type Db = Pool | PoolClient;

export type AttachmentPreviewVariant = "thumb" | "lightbox";

export const ATTACHMENT_PREVIEW_CACHE_VERSION = "v1";

export const ATTACHMENT_PREVIEW_MAX_PX: Record<AttachmentPreviewVariant, number> = {
  thumb: 320,
  lightbox: 1600,
};

const PREVIEW_VARIANTS: AttachmentPreviewVariant[] = ["thumb", "lightbox"];

/** Cap decode work (~120 MP); fixed variants only — no arbitrary dimensions in URLs. */
const SHARP_INPUT_PIXEL_LIMIT = 120_000_000;

function queryFlag(value: unknown): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function assertValidOriginalStorageKey(storageKey: string): void {
  const key = String(storageKey ?? "").trim();
  if (!key || key.includes("..") || key.includes("\0") || /\.preview-v\d+-/i.test(key)) {
    throw Object.assign(new Error("Invalid storage key."), { http: 400 });
  }
}

/** Bare GET serves original bytes; only explicit `preview=thumb|lightbox` (or legacy `preview=1`) builds previews. */
export function parseAttachmentServeMode(
  query: Record<string, unknown>,
  _mime: string,
): "download" | AttachmentPreviewVariant {
  if (queryFlag(query.download)) {
    return "download";
  }
  const preview = String(query.preview ?? "").trim().toLowerCase();
  if (preview === "thumb") {
    return "thumb";
  }
  if (preview === "lightbox" || preview === "1" || preview === "true") {
    return "lightbox";
  }
  return "download";
}

export function previewBlobStorageKey(storageKey: string, variant: AttachmentPreviewVariant): string {
  assertValidOriginalStorageKey(storageKey);
  if (!PREVIEW_VARIANTS.includes(variant)) {
    throw Object.assign(new Error("Invalid preview variant."), { http: 400 });
  }
  return `${storageKey}.preview-${ATTACHMENT_PREVIEW_CACHE_VERSION}-${variant}.jpg`;
}

export async function deleteAttachmentPreviewDerivatives(
  storageKey: string,
  client: Db | null,
): Promise<void> {
  assertValidOriginalStorageKey(storageKey);
  for (const variant of PREVIEW_VARIANTS) {
    await deleteAttachmentBytes(previewBlobStorageKey(storageKey, variant), client);
  }
}

export async function buildRasterPreviewBuffer(
  original: Buffer,
  variant: AttachmentPreviewVariant,
): Promise<Buffer> {
  const maxSide = ATTACHMENT_PREVIEW_MAX_PX[variant];
  try {
    return await sharp(original, {
      limitInputPixels: SHARP_INPUT_PIXEL_LIMIT,
      sequentialRead: true,
    })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: variant === "thumb" ? 78 : 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw Object.assign(new Error("Не удалось построить предпросмотр изображения."), { http: 422 });
  }
}

export async function readOrCreatePreviewBytes(
  storageKey: string,
  mime: string,
  variant: AttachmentPreviewVariant,
  db: Db,
): Promise<Buffer> {
  assertValidOriginalStorageKey(storageKey);
  if (!isSafeInlinePreviewMime(mime)) {
    throw Object.assign(new Error("Предпросмотр недоступен для этого типа файла."), { http: 400 });
  }
  const previewKey = previewBlobStorageKey(storageKey, variant);
  try {
    return await readAttachmentBytes(previewKey, db);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOENT" && !(err instanceof Error && /not found/i.test(err.message))) {
      throw err;
    }
  }
  const original = await readAttachmentBytes(storageKey, db);
  const built = await buildRasterPreviewBuffer(original, variant);
  await writeAttachmentBytes(db, previewKey, built);
  return built;
}

export async function loadAttachmentServePayload(
  storageKey: string,
  mime: string,
  query: Record<string, unknown>,
  db: Db,
): Promise<{ buffer: Buffer; contentType: string }> {
  const mode = parseAttachmentServeMode(query, mime);
  if (mode === "download") {
    return { buffer: await readAttachmentBytes(storageKey, db), contentType: mime };
  }
  const buffer = await readOrCreatePreviewBytes(storageKey, mime, mode, db);
  return { buffer, contentType: "image/jpeg" };
}
