import { validateMaxMediaDownloadUrl } from "../../tanbot-max/max-media-url";

/** Incoming MAX `message_created` image attachment (PhotoAttachmentPayload). */
export function parseMaxImageFromMessage(
  message: Record<string, unknown>,
): { downloadUrl: string; fileName: string; mediaToken: string | null } | null {
  const body = message.body;
  const attachmentsRaw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).attachments
      : message.attachments;
  if (!Array.isArray(attachmentsRaw)) return null;
  for (const att of attachmentsRaw) {
    if (!att || typeof att !== "object") continue;
    const row = att as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.toLowerCase() : "";
    if (type !== "image") continue;
    const payload = row.payload;
    if (!payload || typeof payload !== "object") continue;
    const p = payload as Record<string, unknown>;
    const token = typeof p.token === "string" && p.token.trim() ? p.token.trim() : null;
    const urlRaw = typeof p.url === "string" && p.url.trim() ? p.url.trim() : "";
    if (token && !urlRaw) {
      return { downloadUrl: "", fileName: "photo.jpg", mediaToken: token };
    }
    if (!urlRaw) continue;
    const allowed = validateMaxMediaDownloadUrl(urlRaw);
    if (!allowed.ok) continue;
    const fileName =
      (typeof p.file_name === "string" && p.file_name) ||
      (typeof p.filename === "string" && p.filename) ||
      "photo.jpg";
    return { downloadUrl: allowed.url.href, fileName, mediaToken: token };
  }
  return null;
}
