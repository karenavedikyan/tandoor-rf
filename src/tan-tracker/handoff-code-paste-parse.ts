/** Parse 6-digit handoff receipt codes from paste / autofill (not login OTP). */

export type HandoffCodePasteResult =
  | { ok: true; code: string }
  | { ok: false; reason: string; ambiguous?: boolean };

const CODE_LABEL =
  /(?:код(?:\s+при[её]ма)?(?:\s+для\s+передачи)?|handoff\s+code|one-time\s+code)/i;

function isStandaloneSixDigits(match: string, text: string, index: number): boolean {
  const before = index > 0 ? text[index - 1] : "";
  const after = index + match.length < text.length ? text[index + match.length] : "";
  if (before >= "0" && before <= "9") return false;
  if (after >= "0" && after <= "9") return false;
  return true;
}

function collectLabeledCandidates(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const slice = text.slice(searchFrom);
    const labelMatch = slice.match(CODE_LABEL);
    if (!labelMatch || labelMatch.index == null) break;
    const afterLabel = searchFrom + labelMatch.index + labelMatch[0].length;
    const windowText = text.slice(afterLabel, afterLabel + 160);
    const digitRe = /(?<![0-9])(\d{6})(?![0-9])/g;
    let m: RegExpExecArray | null;
    while ((m = digitRe.exec(windowText))) {
      const abs = afterLabel + m.index;
      if (isStandaloneSixDigits(m[1]!, text, abs)) found.push(m[1]!);
    }
    searchFrom = afterLabel + 1;
  }
  if (found.length) return found;

  const colonRe = /код(?:\s+для\s+передачи)?[^:\n]{0,100}:\s*(?<![0-9])(\d{6})(?![0-9])/gi;
  let cm: RegExpExecArray | null;
  while ((cm = colonRe.exec(text))) {
    if (cm[1]) found.push(cm[1]);
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

  const labeled = collectLabeledCandidates(text);
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

  const loose = [...text.matchAll(/(?<![0-9])(\d{6})(?![0-9])/g)].map((m) => m[1]!);
  const looseUniq = uniqueCodes(loose);
  if (looseUniq.length === 1 && CODE_LABEL.test(text)) {
    return { ok: true, code: looseUniq[0]! };
  }
  if (looseUniq.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      reason: "Не удалось однозначно определить код. Вставьте сообщение с подписью «код» или только 6 цифр.",
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
