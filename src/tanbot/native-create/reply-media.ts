export type NativeReplyMediaKind = "image" | "file";

export type NativeReplyMediaItem = {
  draftId: string;
  sortOrder: number;
  channel: "telegram" | "max";
  mediaKind: NativeReplyMediaKind;
  telegramFileId?: string;
  maxFileToken?: string;
  caption?: string;
};

export type NativeMediaDeliveryProgress = {
  mediaDeliveredCount?: number;
  disposition?: "canceled";
  cancelReason?: string;
};

export const NATIVE_MEDIA_QUEUE_KEY = "nativeMediaQueue";
export const NATIVE_MEDIA_PROGRESS_KEY = "nativeMediaProgress";
export const NATIVE_MEDIA_SCOPE_KEY = "nativeMediaScope";

export function nativeMediaQueueFromDraftAttachment(input: {
  channel: "telegram" | "max";
  draftId: string;
  sortOrder: number;
  fileName: string;
  mimeType: string;
  telegramFileId: string | null;
  maxFileToken: string | null;
}): NativeReplyMediaItem | null {
  const mime = input.mimeType?.toLowerCase() ?? "";
  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");
  if (!isPdf && !isImage) return null;
  const mediaKind: NativeReplyMediaKind = isPdf ? "file" : "image";
  if (input.channel === "telegram") {
    const telegramFileId = input.telegramFileId?.trim();
    if (!telegramFileId) return null;
    return {
      channel: "telegram",
      draftId: input.draftId,
      sortOrder: input.sortOrder,
      mediaKind,
      telegramFileId,
      caption: input.fileName,
    };
  }
  const maxFileToken = input.maxFileToken?.trim();
  if (!maxFileToken) return null;
  return {
    channel: "max",
    draftId: input.draftId,
    sortOrder: input.sortOrder,
    mediaKind,
    maxFileToken,
    caption: input.fileName,
  };
}

/** @deprecated use nativeMediaQueueFromDraftAttachment */
export function nativeMediaQueueFromDraftPhoto(input: {
  channel: "telegram" | "max";
  draftId: string;
  sortOrder: number;
  fileName: string;
  mimeType: string;
  telegramFileId: string | null;
  maxFileToken: string | null;
}): NativeReplyMediaItem | null {
  const item = nativeMediaQueueFromDraftAttachment(input);
  if (!item || item.mediaKind !== "image") return null;
  return item;
}

export function readNativeMediaQueue(raw: unknown): NativeReplyMediaItem[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const row = raw as Record<string, unknown>;
  const queue = row[NATIVE_MEDIA_QUEUE_KEY];
  if (!Array.isArray(queue)) return [];
  const out: NativeReplyMediaItem[] = [];
  for (const item of queue) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const draftId = typeof r.draftId === "string" ? r.draftId : "";
    const sortOrder = typeof r.sortOrder === "number" ? r.sortOrder : Number(r.sortOrder);
    const channel = r.channel === "max" ? "max" : r.channel === "telegram" ? "telegram" : null;
    if (!draftId || !Number.isInteger(sortOrder) || !channel) continue;
    const mediaKind: NativeReplyMediaKind = r.mediaKind === "file" ? "file" : "image";
    const entry: NativeReplyMediaItem = { draftId, sortOrder, channel, mediaKind };
    if (typeof r.telegramFileId === "string" && r.telegramFileId.trim()) {
      entry.telegramFileId = r.telegramFileId.trim();
    }
    if (typeof r.maxFileToken === "string" && r.maxFileToken.trim()) {
      entry.maxFileToken = r.maxFileToken.trim();
    }
    if (typeof r.caption === "string" && r.caption.trim()) entry.caption = r.caption.trim();
    out.push(entry);
  }
  return out;
}

export function readNativeMediaScope(raw: unknown): { messengerChatId: string; actor: "staff" | "external" } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const scope = row[NATIVE_MEDIA_SCOPE_KEY];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as Record<string, unknown>;
  if (typeof s.messengerChatId !== "string" || (s.actor !== "staff" && s.actor !== "external")) return null;
  return { messengerChatId: s.messengerChatId, actor: s.actor };
}

export function readNativeMediaProgress(raw: unknown): NativeMediaDeliveryProgress {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const prog = row[NATIVE_MEDIA_PROGRESS_KEY];
  if (!prog || typeof prog !== "object" || Array.isArray(prog)) return {};
  const p = prog as Record<string, unknown>;
  const out: NativeMediaDeliveryProgress = {};
  if (typeof p.mediaDeliveredCount === "number" && Number.isInteger(p.mediaDeliveredCount)) {
    out.mediaDeliveredCount = p.mediaDeliveredCount;
  }
  if (p.disposition === "canceled") out.disposition = "canceled";
  if (typeof p.cancelReason === "string" && p.cancelReason.trim()) out.cancelReason = p.cancelReason.trim();
  return out;
}

export function mergeReplyExtraRecord(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const merged = { ...base, ...patch };
  if (patch[NATIVE_MEDIA_PROGRESS_KEY] && base[NATIVE_MEDIA_PROGRESS_KEY]) {
    merged[NATIVE_MEDIA_PROGRESS_KEY] = {
      ...(base[NATIVE_MEDIA_PROGRESS_KEY] as Record<string, unknown>),
      ...(patch[NATIVE_MEDIA_PROGRESS_KEY] as Record<string, unknown>),
    };
  }
  return merged;
}

export function markNativeMediaTerminalCanceled(
  extraRecord: Record<string, unknown>,
  reason: string,
  mediaDeliveredCount: number,
): Record<string, unknown> {
  return mergeReplyExtraRecord(extraRecord, {
    [NATIVE_MEDIA_PROGRESS_KEY]: {
      mediaDeliveredCount,
      disposition: "canceled",
      cancelReason: reason,
    },
  });
}
