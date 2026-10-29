import crypto from "crypto";

export type MaxContactAttachmentPayload = {
  vcfInfo: string;
  contactUserId: number | null;
  contactHash: string | null;
};

export function extractPhoneFromVcf(vcfInfo: string): string | null {
  const lines = vcfInfo.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^TEL(?:;[^:]*)?:(.+)$/i);
    if (m?.[1]) {
      const digits = m[1].replace(/\D/g, "");
      if (digits.length >= 10) return digits;
    }
  }
  return null;
}

/** MAX docs: HMAC-SHA256(botToken, decoded vcf_info) compared to attachment hash (hex). */
export function verifyMaxContactVcfHash(
  botToken: string,
  vcfInfo: string,
  hashHex: string,
): boolean {
  if (!botToken || !vcfInfo || !hashHex) return false;
  const expected = crypto.createHmac("sha256", botToken).update(vcfInfo, "utf8").digest();
  let got: Buffer;
  try {
    got = Buffer.from(hashHex.trim(), "hex");
  } catch {
    return false;
  }
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, got);
}

export function parseMaxContactFromMessage(message: Record<string, unknown>): MaxContactAttachmentPayload | null {
  const body = message.body;
  const attachmentsRaw =
    (body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).attachments
      : message.attachments) ?? null;
  if (!Array.isArray(attachmentsRaw)) return null;
  for (const att of attachmentsRaw) {
    if (!att || typeof att !== "object") continue;
    const row = att as Record<string, unknown>;
    if (row.type !== "contact") continue;
    const payload = row.payload;
    if (!payload || typeof payload !== "object") continue;
    const p = payload as Record<string, unknown>;
    const vcfInfo = typeof p.vcf_info === "string" ? p.vcf_info : "";
    if (!vcfInfo.trim()) continue;
    const maxInfo = p.max_info;
    let contactUserId: number | null = null;
    let contactHash: string | null = null;
    if (maxInfo && typeof maxInfo === "object" && !Array.isArray(maxInfo)) {
      const mi = maxInfo as Record<string, unknown>;
      if (typeof mi.user_id === "number") contactUserId = mi.user_id;
      if (typeof mi.hash === "string") contactHash = mi.hash;
    }
    return { vcfInfo, contactUserId, contactHash };
  }
  return null;
}
