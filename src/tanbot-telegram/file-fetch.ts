import { readBoundedResponseBody } from "./bounded-body";
import { fetchBoundedBinary, detectImageMimeFromMagic } from "./bounded-binary-fetch";
import { TELEGRAM_API_ORIGIN } from "./config";
import { loadTanbotTelegramStage2Config } from "./stage2-config";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const META_TIMEOUT_MS = 15_000;

export async function fetchTelegramFileBytes(
  fileId: string,
): Promise<{ ok: true; buffer: Buffer; mimeType: string } | { ok: false; message: string }> {
  const loaded = loadTanbotTelegramStage2Config();
  if (!loaded.ok || !loaded.config.botToken) {
    return { ok: false, message: "Telegram не настроен." };
  }
  const token = loaded.config.botToken;
  const getFileUrl = `${TELEGRAM_API_ORIGIN}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  let metaRes: Response;
  try {
    metaRes = await fetch(getFileUrl, { method: "GET", redirect: "error", signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return { ok: false, message: "Не удалось получить файл." };
  } finally {
    clearTimeout(timer);
  }
  const metaBody = await readBoundedResponseBody(metaRes, 32_768);
  if (!metaRes.ok || !metaBody.ok) return { ok: false, message: "Не удалось получить файл." };
  let meta: { ok?: boolean; result?: { file_path?: string } };
  try {
    meta = JSON.parse(metaBody.text) as { ok?: boolean; result?: { file_path?: string } };
  } catch {
    return { ok: false, message: "Некорректный ответ Telegram." };
  }
  const filePath = meta.result?.file_path;
  if (!meta.ok || !filePath || filePath.includes("..")) {
    return { ok: false, message: "Файл недоступен." };
  }
  const downloadUrl = `${TELEGRAM_API_ORIGIN}/file/bot${token}/${filePath}`;
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
