import { validateMaxMediaDownloadUrl } from "../../tanbot-max/max-media-url";

export type MaxImageIngestReject = "unsafe_url" | "token_only" | "malformed";

export type ParsedMaxImageAttachment = {
  downloadUrl: string;
  fileName: string;
  mediaToken: string | null;
  /** Set when the attachment must not be downloaded but should appear in batch ingest feedback. */
  ingestReject?: MaxImageIngestReject;
};

function fileNameFromPayload(p: Record<string, unknown>): string {
  return (
    (typeof p.file_name === "string" && p.file_name) ||
    (typeof p.filename === "string" && p.filename) ||
    "photo.jpg"
  );
}

function parseOneImagePayload(p: Record<string, unknown>): ParsedMaxImageAttachment {
  const token = typeof p.token === "string" && p.token.trim() ? p.token.trim() : null;
  const urlRaw = typeof p.url === "string" && p.url.trim() ? p.url.trim() : "";
  const fileName = fileNameFromPayload(p);

  if (token && !urlRaw) {
    return { downloadUrl: "", fileName, mediaToken: token, ingestReject: "token_only" };
  }
  if (!urlRaw) {
    return { downloadUrl: "", fileName, mediaToken: token, ingestReject: "malformed" };
  }
  const allowed = validateMaxMediaDownloadUrl(urlRaw);
  if (!allowed.ok) {
    return { downloadUrl: "", fileName, mediaToken: token, ingestReject: "unsafe_url" };
  }
  return { downloadUrl: allowed.url.href, fileName, mediaToken: token };
}

/** All image attachments on a MAX message (album-safe, including rejected slots). */
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
    if (!payload || typeof payload !== "object") {
      out.push({ downloadUrl: "", fileName: "photo.jpg", mediaToken: null, ingestReject: "malformed" });
      continue;
    }
    out.push(parseOneImagePayload(payload as Record<string, unknown>));
  }
  return out;
}

/** First downloadable (or legacy token-only) attachment for single-image callers. */
export function parseMaxImageFromMessage(
  message: Record<string, unknown>,
): ParsedMaxImageAttachment | null {
  const images = parseMaxImagesFromMessage(message);
  for (const img of images) {
    if (img.ingestReject === "unsafe_url" || img.ingestReject === "malformed") continue;
    return {
      downloadUrl: img.downloadUrl,
      fileName: img.fileName,
      mediaToken: img.mediaToken,
    };
  }
  return null;
}
