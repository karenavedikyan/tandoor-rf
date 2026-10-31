export type ReceiptEntryCallback = { action: "code" | "cancel" | "list" | "receive"; transferId: string; version: number };
export function buildReceiptEntryCallback(action: ReceiptEntryCallback["action"], transferId: string, version: number): string | null {
  if (!Number.isSafeInteger(version) || version < 1 || !/^[A-Za-z0-9_.-]{1,64}$/.test(transferId)) return null;
  const payload = `he:${action}:${Buffer.from(transferId, "utf8").toString("base64url")}:${version}`;
  return Buffer.byteLength(payload, "utf8") <= 64 ? payload : null;
}
export function parseReceiptEntryCallback(payload: string): ReceiptEntryCallback | null {
  if (Buffer.byteLength(payload, "utf8") > 64) return null;
  const m = /^he:(code|cancel|list|receive):([A-Za-z0-9_-]+):([1-9]\d*)$/.exec(payload);
  if (!m) return null;
  const version = Number(m[3]);
  if (!Number.isSafeInteger(version)) return null;
  const transferId = Buffer.from(m[2]!, "base64url").toString("utf8");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(transferId)
      || Buffer.from(transferId, "utf8").toString("base64url") !== m[2]) return null;
  return { action: m[1] as ReceiptEntryCallback["action"], transferId, version };
}
