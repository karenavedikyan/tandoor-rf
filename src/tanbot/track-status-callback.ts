export type TrackStatusCallback = { action: "list"; page: number } | { action: "view"; transferId: string };

export function buildTrackStatusCallback(input: TrackStatusCallback): string | null {
  if (input.action === "list") {
    return Number.isSafeInteger(input.page) && input.page >= 0 && input.page <= 99999 ? `ts:l:${input.page}` : null;
  }
  if (!/^[A-Za-z0-9-]{1,64}$/.test(input.transferId)) return null;
  const result = `ts:v:${Buffer.from(input.transferId, "utf8").toString("base64url")}`;
  return Buffer.byteLength(result, "utf8") <= 64 ? result : null;
}

export function parseTrackStatusCallback(data: string): TrackStatusCallback | null {
  if (Buffer.byteLength(data, "utf8") > 64) return null;
  const list = /^ts:l:(0|[1-9]\d{0,4})$/.exec(data);
  if (list) return { action: "list", page: Number(list[1]) };
  const view = /^ts:v:([A-Za-z0-9_-]+)$/.exec(data);
  if (!view) return null;
  const transferId = Buffer.from(view[1]!, "base64url").toString("utf8");
  const result: TrackStatusCallback = { action: "view", transferId };
  return buildTrackStatusCallback(result) === data ? result : null;
}

export function parseTrackStatusText(text: string): { transferId?: string } | null {
  const trimmed = text.trim();
  if (/^статус трека$/iu.test(trimmed)) return {};
  const match = /^статус(?: трека)?\s+(TT-\d{4}-\d{1,12})$/iu.exec(trimmed);
  return match ? { transferId: match[1]!.toUpperCase() } : null;
}
