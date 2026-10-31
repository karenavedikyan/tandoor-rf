import crypto from "crypto";

export type MaxContactAttachmentPayload = {
  vcfInfo: string;
  contactUserId: number;
  contactHash: string;
};

/** Convert JSON-escaped CRLF/LF in vcf_info to real line breaks before HMAC (MAX platform API). */
export function decodeVcfInfoForHmac(vcfInfo: string): string {
  return vcfInfo.replace(/\\r\\n/g, "\r\n").replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}

export function extractPhoneFromVcf(vcfInfo: string): string | null {
  const decoded = decodeVcfInfoForHmac(vcfInfo);
  const lines = decoded.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^TEL(?:;[^:]*)?:(.+)$/i);
    if (m?.[1]) {
      const digits = m[1].replace(/\D/g, "");
      if (digits.length >= 10) return digits;
    }
  }
  return null;
}

/** MAX docs: HMAC-SHA256(access_token, decoded vcf_info) compared to payload.hash (hex). */
export function verifyMaxContactVcfHash(
  botToken: string,
  vcfInfo: string,
  hashHex: string,
): boolean {
  if (!botToken || !vcfInfo || !hashHex) return false;
  const decoded = decodeVcfInfoForHmac(vcfInfo);
  const expected = crypto.createHmac("sha256", botToken).update(decoded, "utf8").digest();
  let got: Buffer;
  try {
    got = Buffer.from(hashHex.trim(), "hex");
  } catch {
    return false;
  }
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, got);
}

/** Third-party / phonebook contact from paperclip: vcf without platform hash (MAX docs). */
export function parseMaxUnsignedRecipientVcfFromMessage(
  message: Record<string, unknown>,
): { vcfInfo: string } | null {
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
    const contactHash = typeof p.hash === "string" ? p.hash.trim() : "";
    const maxInfo = p.max_info;
    const hasSignedOwn =
      contactHash &&
      maxInfo &&
      typeof maxInfo === "object" &&
      !Array.isArray(maxInfo) &&
      typeof (maxInfo as Record<string, unknown>).user_id === "number";
    if (hasSignedOwn) continue;
    return { vcfInfo };
  }
  return null;
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
    const contactHash = typeof p.hash === "string" && p.hash.trim() ? p.hash.trim() : "";
    if (!contactHash) continue;
    const maxInfo = p.max_info;
    if (!maxInfo || typeof maxInfo !== "object" || Array.isArray(maxInfo)) continue;
    const mi = maxInfo as Record<string, unknown>;
    if (typeof mi.user_id !== "number" || !Number.isInteger(mi.user_id) || mi.user_id <= 0) continue;
    return { vcfInfo, contactUserId: mi.user_id, contactHash };
  }
  return null;
}
