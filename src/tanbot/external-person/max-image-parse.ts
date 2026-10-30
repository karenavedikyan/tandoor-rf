/** MAX message image attachment (platform API body.attachments). */
export function parseMaxImageFromMessage(
  message: Record<string, unknown>,
): { downloadUrl: string; fileName: string } | null {
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
    if (type !== "image" && type !== "photo") continue;
    const payload = row.payload;
    if (!payload || typeof payload !== "object") continue;
    const p = payload as Record<string, unknown>;
    const url =
      (typeof p.url === "string" && p.url) ||
      (typeof p.download_url === "string" && p.download_url) ||
      (typeof p.photo_url === "string" && p.photo_url) ||
      "";
    if (!url.startsWith("https://")) continue;
    const fileName =
      (typeof p.file_name === "string" && p.file_name) ||
      (typeof p.filename === "string" && p.filename) ||
      "photo.jpg";
    return { downloadUrl: url, fileName };
  }
  return null;
}
