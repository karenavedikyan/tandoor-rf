import { readBoundedResponseBody } from "./bounded-body";
import { TELEGRAM_API_ORIGIN } from "./config";
import { loadTanbotTelegramStage2Config } from "./stage2-config";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function fetchTelegramFileBytes(
  fileId: string,
): Promise<{ ok: true; buffer: Buffer; mimeType: string } | { ok: false; message: string }> {
  const loaded = loadTanbotTelegramStage2Config();
  if (!loaded.ok || !loaded.config.botToken) {
    return { ok: false, message: "Telegram не настроен." };
  }
  const token = loaded.config.botToken;
  const getFileUrl = `${TELEGRAM_API_ORIGIN}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const metaRes = await fetch(getFileUrl, { method: "GET" });
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
  const fileRes = await fetch(downloadUrl, { method: "GET" });
  const fileBytes = await fileRes.arrayBuffer();
  if (!fileRes.ok || fileBytes.byteLength === 0 || fileBytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, message: "Не удалось скачать файл." };
  }
  const buf = Buffer.from(fileBytes);
  const mimeType = guessMime(filePath);
  if (!ALLOWED_MIME.has(mimeType)) {
    return { ok: false, message: "Допустимы только изображения JPEG/PNG/WebP/GIF." };
  }
  return { ok: true, buffer: buf, mimeType };
}

function guessMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
