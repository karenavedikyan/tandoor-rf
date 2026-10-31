import { decodeUploadFilename } from "../../tan-tracker/attachments";
import { detectImageMimeFromMagic } from "../../tanbot-telegram/bounded-binary-fetch";

const PDF_HEADER = Buffer.from("%PDF-", "ascii");

export function isPdfMagic(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).equals(PDF_HEADER);
}

/** Storage MIME for native wizard bytes (never rejects nonempty buffers). */
export function classifyNativeStorageMime(buffer: Buffer): string {
  if (!buffer.length) return "application/octet-stream";
  const image = detectImageMimeFromMagic(buffer);
  if (image) return image;
  if (isPdfMagic(buffer)) return "application/pdf";
  return "application/octet-stream";
}

export function isHlsOrPlaylistManifest(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 64)).toString("utf8").trimStart();
  return head.startsWith("#EXTM3U");
}

export function safeNativeAttachmentFileName(raw: string, fallback = "file"): string {
  const decoded = decodeUploadFilename(raw?.trim() ? raw : fallback);
  return decoded.slice(0, 200) || fallback;
}

/** @deprecated use classifyNativeStorageMime */
export function detectNativeAttachmentMime(buffer: Buffer): { kind: "image"; mimeType: string } | { kind: "pdf"; mimeType: "application/pdf" } | null {
  if (!buffer.length) return null;
  const mime = classifyNativeStorageMime(buffer);
  if (mime === "application/pdf") return { kind: "pdf", mimeType: "application/pdf" };
  if (mime.startsWith("image/")) return { kind: "image", mimeType: mime };
  return null;
}
