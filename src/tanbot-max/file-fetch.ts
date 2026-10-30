import { fetchBoundedBinary, detectImageMimeFromMagic } from "../tanbot-telegram/bounded-binary-fetch";
import { parseMaxImageFromMessage } from "../tanbot/external-person/max-image-parse";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function parseMaxImageAttachment(message: Record<string, unknown>) {
  return parseMaxImageFromMessage(message);
}

export async function fetchMaxImageBytes(
  downloadUrl: string,
): Promise<{ ok: true; buffer: Buffer; mimeType: string } | { ok: false; message: string }> {
  const file = await fetchBoundedBinary(downloadUrl, MAX_FILE_BYTES);
  if (!file.ok) {
    return { ok: false, message: "Не удалось скачать файл." };
  }
  const mimeType = detectImageMimeFromMagic(file.buffer);
  if (!mimeType) {
    return { ok: false, message: "Допустимы только изображения JPEG/PNG/WebP/GIF." };
  }
  return { ok: true, buffer: file.buffer, mimeType };
}
