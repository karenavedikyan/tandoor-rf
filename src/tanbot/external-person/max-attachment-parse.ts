import { validateMaxMediaDownloadUrl } from "../../tanbot-max/max-media-url";
import type { MaxImageIngestReject } from "./max-image-parse";
import { parseMaxImagesFromMessage, type ParsedMaxImageAttachment } from "./max-image-parse";

export type MaxAttachmentKind = "image" | "file";

export type ParsedMaxMixedAttachment = {
  kind: MaxAttachmentKind;
  downloadUrl: string;
  fileName: string;
  mediaToken: string | null;
  declaredSize: number | null;
  ingestReject?: MaxImageIngestReject;
};

function fileNameFromAttachment(att: Record<string, unknown>, payload: Record<string, unknown>, fallback: string): string {
  return (
    (typeof att.filename === "string" && att.filename.trim()) ||
    (typeof att.file_name === "string" && att.file_name.trim()) ||
    (typeof payload.filename === "string" && payload.filename.trim()) ||
    (typeof payload.file_name === "string" && payload.file_name.trim()) ||
    fallback
  );
}

function declaredSizeFromAttachment(att: Record<string, unknown>, payload: Record<string, unknown>): number | null {
  const raw =
    typeof att.size === "number" && Number.isFinite(att.size)
      ? att.size
      : typeof payload.size === "number" && Number.isFinite(payload.size)
        ? payload.size
        : null;
  if (raw == null || raw < 0) return null;
  return Math.trunc(raw);
}

function parseOnePayloadAttachment(
  kind: MaxAttachmentKind,
  att: Record<string, unknown>,
  payload: Record<string, unknown>,
): ParsedMaxMixedAttachment {
  const token = typeof payload.token === "string" && payload.token.trim() ? payload.token.trim() : null;
  const urlRaw = typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : "";
  const fallbackName = kind === "file" ? "document.pdf" : "photo.jpg";
  const fileName = fileNameFromAttachment(att, payload, fallbackName);
  const declaredSize = declaredSizeFromAttachment(att, payload);

  if (token && !urlRaw) {
    return { kind, downloadUrl: "", fileName, mediaToken: token, declaredSize, ingestReject: "token_only" };
  }
  if (!urlRaw) {
    return { kind, downloadUrl: "", fileName, mediaToken: token, declaredSize, ingestReject: "malformed" };
  }
  const allowed = validateMaxMediaDownloadUrl(urlRaw);
  if (!allowed.ok) {
    return { kind, downloadUrl: "", fileName, mediaToken: token, declaredSize, ingestReject: "unsafe_url" };
  }
  return { kind, downloadUrl: allowed.url.href, fileName, mediaToken: token, declaredSize };
}

/** Image and file attachments on a MAX message in webhook order (album-safe). */
export function parseMaxAttachmentsFromMessage(message: Record<string, unknown>): ParsedMaxMixedAttachment[] {
  const body = message.body;
  const attachmentsRaw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).attachments
      : message.attachments;
  if (!Array.isArray(attachmentsRaw)) return [];
  const out: ParsedMaxMixedAttachment[] = [];
  for (const att of attachmentsRaw) {
    if (!att || typeof att !== "object") continue;
    const row = att as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.toLowerCase() : "";
    if (type !== "image" && type !== "file") continue;
    const payload = row.payload;
    const kind: MaxAttachmentKind = type === "file" ? "file" : "image";
    if (!payload || typeof payload !== "object") {
      out.push({
        kind,
        downloadUrl: "",
        fileName: kind === "file" ? "document.pdf" : "photo.jpg",
        mediaToken: null,
        declaredSize: declaredSizeFromAttachment(row, {}),
        ingestReject: "malformed",
      });
      continue;
    }
    out.push(parseOnePayloadAttachment(kind, row, payload as Record<string, unknown>));
  }
  return out;
}

export function parsedMaxImagesToMixed(images: ParsedMaxImageAttachment[]): ParsedMaxMixedAttachment[] {
  return images.map((img) => ({
    kind: "image" as const,
    downloadUrl: img.downloadUrl,
    fileName: img.fileName,
    mediaToken: img.mediaToken,
    declaredSize: null,
    ingestReject: img.ingestReject,
  }));
}

export function messageHasNativeFileOrImageAttachments(message: Record<string, unknown>): boolean {
  const body = message.body;
  const attachmentsRaw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).attachments
      : message.attachments;
  if (!Array.isArray(attachmentsRaw)) return false;
  return attachmentsRaw.some((att) => {
    if (!att || typeof att !== "object") return false;
    const typeRaw = (att as Record<string, unknown>).type;
    const type = typeof typeRaw === "string" ? typeRaw.toLowerCase() : "";
    return type === "image" || type === "file";
  });
}

/** @deprecated use parseMaxAttachmentsFromMessage */
export { parseMaxImagesFromMessage };
