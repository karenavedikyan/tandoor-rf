/** Parse 6-digit handoff receipt codes from paste / autofill (not login OTP). */

export type HandoffCodePasteResult =
  | { ok: true; code: string }
  | { ok: false; reason: string; ambiguous?: boolean };

function isStandaloneSixDigits(_match: string, text: string, index: number): boolean {
  const before = index > 0 ? text[index - 1] : "";
  const after = index + 6 < text.length ? text[index + 6] : "";
  if (before >= "0" && before <= "9") return false;
  if (after >= "0" && after <= "9") return false;
  return true;
}

/** Six digits that are the numeric suffix of a public track id (TT-2026-123456). */
export function isTrackPublicCodeSuffix(text: string, digitStart: number): boolean {
  const before = text.slice(Math.max(0, digitStart - 32), digitStart);
  return /(?:^|[\s,.(])TT-\d{4}-$/i.test(before.trimEnd()) || /передача\s+TT-\d{4}-$/i.test(before.toLowerCase());
}

function acceptSixAt(text: string, digitStart: number, digits: string): boolean {
  if (!isStandaloneSixDigits(digits, text, digitStart)) return false;
  if (isTrackPublicCodeSuffix(text, digitStart)) return false;
  return true;
}

function collectColonLabeledCandidates(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /(?:код(?:\s+при[её]ма)?(?:\s+для\s+передачи)?(?!\s+пока\s+не)|handoff\s+code|one-time\s+code)(?:\s+TT[-\w]+)?\s*[:：]\s*(?<![0-9])(\d{6})(?![0-9])/gi,
    /(?:^|[\n\r])\s*код\s*[:：]\s*(?<![0-9])(\d{6})(?![0-9])/gi,
    /повтор\s+кода\s*[:：]\s*(?<![0-9])(\d{6})(?![0-9])/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const idx = m.index + m[0].length - m[1]!.length;
      if (acceptSixAt(text, idx, m[1]!)) found.push(m[1]!);
    }
  }
  return found;
}

function directSixDigitCompact(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[\d\s-]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 6) return digits;
  }
  const only = trimmed.replace(/\D/g, "");
  if (only.length === 6 && trimmed.replace(/[\d\s-]/g, "") === "") return only;
  return null;
}

function uniqueCodes(codes: string[]): string[] {
  return [...new Set(codes)];
}

export function parseHandoffCodePaste(raw: string): HandoffCodePasteResult {
  const text = String(raw ?? "");
  if (!text.trim()) {
    return { ok: false, reason: "" };
  }

  const direct = directSixDigitCompact(text);
  if (direct) {
    return { ok: true, code: direct };
  }

  const labeled = collectColonLabeledCandidates(text);
  const uniq = uniqueCodes(labeled);
  if (uniq.length === 1) {
    return { ok: true, code: uniq[0]! };
  }
  if (uniq.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      reason: "В тексте несколько разных кодов. Скопируйте только одно сообщение с кодом.",
    };
  }

  if (text.replace(/\D/g, "").length > 6) {
    return {
      ok: false,
      ambiguous: true,
      reason: "Вставленный текст не содержит однозначного 6-значного кода.",
    };
  }

  return { ok: false, reason: "" };
}
