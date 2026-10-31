import { readBoundedResponseBody } from "../../tanbot-telegram/bounded-body";
import { fetchBoundedBinaryRaw } from "../../tanbot-telegram/bounded-binary-fetch";
import { TELEGRAM_API_ORIGIN } from "../../tanbot-telegram/config";
import { loadTanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import { validateMaxMediaDownloadUrl } from "../../tanbot-max/max-media-url";
import { detectNativeAttachmentMime } from "./native-attachment-magic";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const META_TIMEOUT_MS = 15_000;

function attachmentRejectMessage(code: string): string {
  switch (code) {
    case "TOO_LARGE":
      return "Файл больше 8 МБ. Отправьте файл меньше.";
    case "EMPTY":
      return "Пустой файл не принимается.";
    case "UNSUPPORTED":
      return "Поддерживаются только фото (JPEG/PNG/WebP/GIF) и PDF.";
    case "FAKE_PDF":
      return "Файл не является PDF. Отправьте документ в формате PDF.";
    default:
      return "Не удалось скачать файл.";
  }
}

function validateFetchedAttachment(
  buffer: Buffer,
  declaredMime?: string | null,
): { ok: true; mimeType: string } | { ok: false; message: string } {
  if (!buffer.length) return { ok: false, message: attachmentRejectMessage("EMPTY") };
  const detected = detectNativeAttachmentMime(buffer);
  if (!detected) {
    const declared = (declaredMime ?? "").toLowerCase();
    if (declared.includes("pdf")) return { ok: false, message: attachmentRejectMessage("FAKE_PDF") };
    return { ok: false, message: attachmentRejectMessage("UNSUPPORTED") };
  }
  return { ok: true, mimeType: detected.mimeType };
}

export async function fetchTelegramNativeAttachmentBytes(
  fileId: string,
  declaredMime?: string | null,
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
  if (!meta.ok || !filePath || filePath.includes("..") || /^https?:\/\//i.test(filePath)) {
    return { ok: false, message: "Файл недоступен." };
  }
  const downloadUrl = `${TELEGRAM_API_ORIGIN}/file/bot${token}/${filePath}`;
  const file = await fetchBoundedBinaryRaw(downloadUrl, MAX_ATTACHMENT_BYTES);
  if (!file.ok) {
    return { ok: false, message: attachmentRejectMessage(file.code === "TOO_LARGE" ? "TOO_LARGE" : "default") };
  }
  const validated = validateFetchedAttachment(file.buffer, declaredMime);
  if (!validated.ok) return validated;
  return { ok: true, buffer: file.buffer, mimeType: validated.mimeType };
}

export async function fetchMaxNativeAttachmentBytes(
  downloadUrl: string,
): Promise<{ ok: true; buffer: Buffer; mimeType: string } | { ok: false; message: string }> {
  const allowed = validateMaxMediaDownloadUrl(downloadUrl);
  if (!allowed.ok) {
    return { ok: false, message: "Ссылка на файл недоступна." };
  }
  const file = await fetchBoundedBinaryRaw(allowed.url.href, MAX_ATTACHMENT_BYTES);
  if (!file.ok) {
    return { ok: false, message: attachmentRejectMessage(file.code === "TOO_LARGE" ? "TOO_LARGE" : "default") };
  }
  const validated = validateFetchedAttachment(file.buffer);
  if (!validated.ok) return validated;
  return { ok: true, buffer: file.buffer, mimeType: validated.mimeType };
}
