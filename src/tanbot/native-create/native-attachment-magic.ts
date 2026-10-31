import { detectImageMimeFromMagic } from "../../tanbot-telegram/bounded-binary-fetch";

const PDF_HEADER = Buffer.from("%PDF-", "ascii");

export type NativeAttachmentMime = { kind: "image"; mimeType: string } | { kind: "pdf"; mimeType: "application/pdf" };

export function isPdfMagic(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).equals(PDF_HEADER);
}

export function detectNativeAttachmentMime(buffer: Buffer): NativeAttachmentMime | null {
  if (!buffer.length) return null;
  const image = detectImageMimeFromMagic(buffer);
  if (image) return { kind: "image", mimeType: image };
  if (isPdfMagic(buffer)) return { kind: "pdf", mimeType: "application/pdf" };
  return null;
}

export function canonicalNativeAttachmentFileName(fileName: string, detected: NativeAttachmentMime): string {
  const base = fileName.trim() || (detected.kind === "pdf" ? "document.pdf" : "photo.jpg");
  const lower = base.toLowerCase();
  if (detected.kind === "pdf") {
    if (lower.endsWith(".pdf")) return base.slice(0, 200);
    return `${base.replace(/\.[^./\\]+$/, "") || "document"}.pdf`.slice(0, 200);
  }
  const ext =
    detected.mimeType === "image/png"
      ? ".png"
      : detected.mimeType === "image/gif"
        ? ".gif"
        : detected.mimeType === "image/webp"
          ? ".webp"
          : ".jpg";
  if (/\.(jpe?g|png|gif|webp)$/i.test(lower)) return base.slice(0, 200);
  return `${base.replace(/\.[^./\\]+$/, "") || "photo"}${ext}`.slice(0, 200);
}
