import type { NativeCreateDraftPayload } from "./draft-scope";

export type NativeAttachmentTransportKind = "image" | "file" | "video";

export function recordNativeAttachmentTransportKind(
  payload: NativeCreateDraftPayload,
  sortOrder: number,
  kind: NativeAttachmentTransportKind,
): void {
  if (!payload.nativeAttachmentTransportBySort) {
    payload.nativeAttachmentTransportBySort = {};
  }
  payload.nativeAttachmentTransportBySort[String(sortOrder)] = kind;
}

export function readNativeAttachmentTransportKind(
  payload: NativeCreateDraftPayload,
  sortOrder: number,
  mimeType?: string,
): NativeAttachmentTransportKind {
  const mapped = payload.nativeAttachmentTransportBySort?.[String(sortOrder)];
  if (mapped === "image" || mapped === "file" || mapped === "video") return mapped;
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime === "application/pdf" || mime === "application/octet-stream") return "file";
  if (mime.startsWith("video/")) return "video";
  return "image";
}

export function maxProviderKindToTransport(kind: "image" | "file" | "video"): NativeAttachmentTransportKind {
  return kind;
}
