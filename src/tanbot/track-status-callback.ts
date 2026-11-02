export type TrackStatusCallback = { action: "list"; page: number } | { action: "view"; transferId: string; archivePage?: number };

export function buildTrackStatusCallback(input: TrackStatusCallback): string | null {
  if (input.action === "list") {
    return Number.isSafeInteger(input.page) && input.page >= 0 && input.page <= 99999 ? `ts:l:${input.page}` : null;
  }
  if (!/^[A-Za-z0-9-]{1,64}$/.test(input.transferId)) return null;
  if (input.archivePage !== undefined &&
    (!Number.isSafeInteger(input.archivePage) || input.archivePage < 0 || input.archivePage > 99999)) return null;
  const prefix = input.archivePage === undefined ? "ts:v" : `ts:a:${input.archivePage}`;
  const result = `${prefix}:${Buffer.from(input.transferId, "utf8").toString("base64url")}`;
  return Buffer.byteLength(result, "utf8") <= 64 ? result : null;
}

export function parseTrackStatusCallback(data: string): TrackStatusCallback | null {
  if (Buffer.byteLength(data, "utf8") > 64) return null;
  const list = /^ts:l:(0|[1-9]\d{0,4})$/.exec(data);
  if (list) return { action: "list", page: Number(list[1]) };
  const view = /^ts:v:([A-Za-z0-9_-]+)$/.exec(data);
  const archive = /^ts:a:(0|[1-9]\d{0,4}):([A-Za-z0-9_-]+)$/.exec(data);
  if (!view && !archive) return null;
  const transferId = Buffer.from(archive ? archive[2]! : view![1]!, "base64url").toString("utf8");
  const result: TrackStatusCallback = { action: "view", transferId,
    ...(archive ? { archivePage: Number(archive[1]) } : {}) };
  return buildTrackStatusCallback(result) === data ? result : null;
}

export function parseTrackStatusText(text: string): { transferId?: string } | null {
  const trimmed = text.trim();
  if (/^статус трека$/iu.test(trimmed)) return {};
  const match = /^статус(?: трека)?\s+(TT-\d{4}-\d{1,12})$/iu.exec(trimmed);
  return match ? { transferId: match[1]!.toUpperCase() } : null;
}
