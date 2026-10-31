import { normalizeRuPhoneE164 } from "../../tan-tracker/phone-normalize";

export const MAX_RECIPIENT_VCF_BYTES = 16_384;
export const MAX_RECIPIENT_NAME_LEN = 120;

export type ParsedRecipientContact = {
  suggestedName: string | null;
  phonesE164: string[];
};

export type ParseRecipientContactResult =
  | { ok: true; data: ParsedRecipientContact }
  | { ok: false; code: string; message: string };

export function sanitizeRecipientDisplayName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length > MAX_RECIPIENT_NAME_LEN) s = `${s.slice(0, MAX_RECIPIENT_NAME_LEN - 1)}…`;
  return s;
}

function uniquePhones(candidates: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const n = normalizeRuPhoneE164(c);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function unfoldVcfLines(vcf: string): string[] {
  const decoded = vcf.replace(/\\r\\n/g, "\r\n").replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  const physical = decoded.split(/\r?\n/);
  const logical: string[] = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line) && logical.length) {
      logical[logical.length - 1] += line.replace(/^[ \t]+/, "");
    } else {
      logical.push(line);
    }
  }
  return logical;
}

function nameFromVcfLines(lines: string[]): string | null {
  for (const line of lines) {
    const fn = line.match(/^FN(?:;[^:]*)?:(.+)$/i);
    if (fn?.[1]) {
      const n = sanitizeRecipientDisplayName(fn[1]);
      if (n) return n;
    }
  }
  for (const line of lines) {
    const nField = line.match(/^N(?:;[^:]*)?:(.+)$/i);
    if (!nField?.[1]) continue;
    const parts = nField[1].split(";").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    const joined = sanitizeRecipientDisplayName(parts.reverse().join(" "));
    if (joined) return joined;
  }
  return null;
}

function phonesFromVcfLines(lines: string[]): string[] {
  const raw: string[] = [];
  for (const line of lines) {
    const tel = line.match(/^TEL(?:;[^:]*)?:(.+)$/i);
    if (!tel?.[1]) continue;
    let value = tel[1].trim();
    if (/^tel:/i.test(value)) value = value.replace(/^tel:/i, "");
    raw.push(value);
  }
  return uniquePhones(raw);
}

export function parseRecipientContactFromVcf(vcfInfo: string): ParseRecipientContactResult {
  if (!vcfInfo || typeof vcfInfo !== "string") {
    return { ok: false, code: "EMPTY", message: "Контакт пуст." };
  }
  if (Buffer.byteLength(vcfInfo, "utf8") > MAX_RECIPIENT_VCF_BYTES) {
    return { ok: false, code: "TOO_LARGE", message: "Контакт слишком большой. Отправьте другой или введите телефон вручную." };
  }
  const lines = unfoldVcfLines(vcfInfo);
  const phonesE164 = phonesFromVcfLines(lines);
  if (!phonesE164.length) {
    return { ok: false, code: "NO_PHONE", message: "В контакте нет подходящего номера (+7). Введите телефон вручную." };
  }
  const suggestedName = nameFromVcfLines(lines);
  return { ok: true, data: { suggestedName, phonesE164 } };
}

export function parseRecipientContactFromTelegram(input: {
  phoneRaw: string;
  firstName?: string | null;
  lastName?: string | null;
  vcard?: string | null;
}): ParseRecipientContactResult {
  if (
    Buffer.byteLength(input.phoneRaw, "utf8") > 64 ||
    (input.vcard && Buffer.byteLength(input.vcard, "utf8") > MAX_RECIPIENT_VCF_BYTES)
  ) {
    return { ok: false, code: "TOO_LARGE", message: "Контакт слишком большой. Отправьте другой или введите телефон вручную." };
  }
  const phone = normalizeRuPhoneE164(input.phoneRaw);
  if (!phone) {
    return { ok: false, code: "NO_PHONE", message: "Номер не распознан. Введите телефон вручную: 10 цифр после +7." };
  }
  if (input.vcard?.trim()) {
    const fromVcf = parseRecipientContactFromVcf(input.vcard);
    if (fromVcf.ok && fromVcf.data.phonesE164.length) {
      const tgName = sanitizeRecipientDisplayName(
        [input.firstName, input.lastName].filter(Boolean).join(" "),
      );
      return {
        ok: true,
        data: {
          phonesE164: uniquePhones([phone, ...fromVcf.data.phonesE164]),
          suggestedName: tgName ?? fromVcf.data.suggestedName,
        },
      };
    }
  }
  const suggestedName = sanitizeRecipientDisplayName(
    [input.firstName, input.lastName].filter(Boolean).join(" "),
  );
  return { ok: true, data: { suggestedName, phonesE164: [phone] } };
}
