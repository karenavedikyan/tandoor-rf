import { validateMaxMediaDownloadUrl } from "../../tanbot-max/max-media-url";

export type ParsedMaxImageAttachment = {
  downloadUrl: string;
  fileName: string;
  mediaToken: string | null;
};

function parseOneImagePayload(p: Record<string, unknown>): ParsedMaxImageAttachment | null {
  const token = typeof p.token === "string" && p.token.trim() ? p.token.trim() : null;
  const urlRaw = typeof p.url === "string" && p.url.trim() ? p.url.trim() : "";
  if (token && !urlRaw) {
    return { downloadUrl: "", fileName: "photo.jpg", mediaToken: token };
  }
  if (!urlRaw) return null;
  const allowed = validateMaxMediaDownloadUrl(urlRaw);
  if (!allowed.ok) return null;
  const fileName =
    (typeof p.file_name === "string" && p.file_name) ||
    (typeof p.filename === "string" && p.filename) ||
    "photo.jpg";
  return { downloadUrl: allowed.url.href, fileName, mediaToken: token };
}

/** All image attachments on a MAX message (album-safe). */
export function parseMaxImagesFromMessage(message: Record<string, unknown>): ParsedMaxImageAttachment[] {
  const body = message.body;
  const attachmentsRaw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).attachments
      : message.attachments;
  if (!Array.isArray(attachmentsRaw)) return [];
  const out: ParsedMaxImageAttachment[] = [];
  for (const att of attachmentsRaw) {
    if (!att || typeof att !== "object") continue;
    const row = att as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.toLowerCase() : "";
    if (type !== "image") continue;
    const payload = row.payload;
    if (!payload || typeof payload !== "object") continue;
    const parsed = parseOneImagePayload(payload as Record<string, unknown>);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** First image attachment (legacy single-image callers). */
export function parseMaxImageFromMessage(
  message: Record<string, unknown>,
): ParsedMaxImageAttachment | null {
  return parseMaxImagesFromMessage(message)[0] ?? null;
}
