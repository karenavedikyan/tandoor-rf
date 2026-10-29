import crypto from "crypto";

export function computeMaxUpdateDedupKey(input: {
  updateType: string;
  timestamp: number;
  chatId: number;
  userId: number;
  messageMid?: string | null;
}): string {
  const payload = [
    input.updateType,
    String(input.timestamp),
    String(input.chatId),
    String(input.userId),
    input.messageMid ?? "",
  ].join("\0");
  return crypto.createHash("sha256").update(payload).digest("hex");
}
