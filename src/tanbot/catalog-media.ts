import sharp from "sharp";
import { readBoundedResponseBody } from "../tanbot-telegram/bounded-body";
import { MAX_API_ORIGIN } from "../tanbot-max/config";
import { validateMaxMediaDownloadUrl } from "../tanbot-max/max-media-url";

/** Only bounded, already checksum-verified 640px derivatives reach this helper.
 * JPEG is supported by both messengers. Pad extreme strips for Telegram's
 * aspect-ratio limit; never crop, upscale or process full-size source files.
 */
export async function catalogJpeg(bytes: Buffer): Promise<Buffer | null> {
  if (!bytes.length || bytes.length > 131072) return null;
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: 640 * 640 }).timeout({ seconds: 3 });
    const meta = await image.metadata();
    if (meta.format !== "webp" || !meta.width || !meta.height || meta.width > 640 || meta.height > 640) return null;
    if (Math.max(meta.width / meta.height, meta.height / meta.width) > 19) {
      image.resize({ width: Math.max(meta.width, Math.ceil(meta.height / 19)),
        height: Math.max(meta.height, Math.ceil(meta.width / 19)), fit: "contain", background: "#ffffff" });
    }
    const jpeg = await image.flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    return jpeg.length <= 1024 * 1024 ? jpeg : null;
  } catch { return null; }
}

export function photoForm(bytes: Buffer, field: string): FormData {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "model.jpg");
  return form;
}

/** Upload URL comes only from the authenticated MAX API, not from a callback.
 * Bot authorization is sent ONLY to the API origin, never to a CDN/upload URL.
 * Keep the transports separate: the API's custom CA replaces Node's trust
 * store and must not be applied to globally trusted upload/CDN certificates.
 */
export async function uploadMaxCatalogPhoto(transports: { api: typeof fetch; upload: typeof fetch }, input: {
  token: string; bytes: Buffer; signal: AbortSignal; maxResponseBytes: number;
}): Promise<string | null> {
  const init = await transports.api(`${MAX_API_ORIGIN}/uploads?type=image`, {
    method: "POST", headers: { Authorization: input.token, Accept: "application/json" },
    signal: input.signal, redirect: "error",
  });
  const initialBody = await readBoundedResponseBody(init, input.maxResponseBytes);
  if (!init.ok || !initialBody.ok) return null;
  const data = JSON.parse(initialBody.text) as { url?: unknown };
  if (typeof data.url !== "string") return null;
  const checked = validateMaxMediaDownloadUrl(data.url);
  if (!checked.ok) return null;
  const upload = await transports.upload(checked.url, { method: "POST", body: photoForm(input.bytes, "data"),
    signal: input.signal, redirect: "error" });
  const uploadBody = await readBoundedResponseBody(upload, input.maxResponseBytes);
  if (!upload.ok || !uploadBody.ok) return null;
  const result = JSON.parse(uploadBody.text) as { photos?: Record<string, { token?: unknown }> };
  const photos = result.photos && typeof result.photos === "object" ? Object.values(result.photos) : [];
  // Exactly one upload must resolve to exactly one image; do not select an arbitrary image.
  const token = photos.length === 1 ? photos[0]?.token : null;
  return typeof token === "string" && token.length > 0 && token.length <= 8192 ? token : null;
}
