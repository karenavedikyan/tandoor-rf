(function () {
  "use strict";

  function isStandaloneSixDigits(_match, text, index) {
    var before = index > 0 ? text[index - 1] : "";
    var after = index + 6 < text.length ? text[index + 6] : "";
    if (before >= "0" && before <= "9") return false;
    if (after >= "0" && after <= "9") return false;
    return true;
  }

  function isTrackPublicCodeSuffix(text, digitStart) {
    var before = text.slice(Math.max(0, digitStart - 32), digitStart);
    return /(?:^|[\s,.(])TT-\d{4}-$/i.test(before.trimEnd()) || /передача\s+TT-\d{4}-$/i.test(before.toLowerCase());
  }

  function acceptSixAt(text, digitStart, digits) {
    if (!isStandaloneSixDigits(digits, text, digitStart)) return false;
    if (isTrackPublicCodeSuffix(text, digitStart)) return false;
    return true;
  }

  function collectColonLabeledCandidates(text) {
    var found = [];
    var patterns = [
      /(?:код(?:\s+при[её]ма)?(?:\s+для\s+передачи)?(?!\s+пока\s+не)|handoff\s+code|one-time\s+code)(?:\s+TT[-\w]+)?\s*[:：]\s*(?<![0-9])(\d{6})(?![0-9])/gi,
      /(?:^|[\n\r])\s*код\s*[:：]\s*(?<![0-9])(\d{6})(?![0-9])/gi,
      /повтор\s+кода\s*[:：]\s*(?<![0-9])(\d{6})(?![0-9])/gi,
    ];
    for (var p = 0; p < patterns.length; p++) {
      var re = patterns[p];
      var m;
      while ((m = re.exec(text))) {
        var idx = m.index + m[0].length - m[1].length;
        if (acceptSixAt(text, idx, m[1])) found.push(m[1]);
      }
    }
    return found;
  }

  function directSixDigitCompact(raw) {
    var trimmed = String(raw || "").trim();
    if (!trimmed) return null;
    if (/^[\d\s-]+$/.test(trimmed)) {
      var digits = trimmed.replace(/\D/g, "");
      if (digits.length === 6) return digits;
    }
    var only = trimmed.replace(/\D/g, "");
    if (only.length === 6 && trimmed.replace(/[\d\s-]/g, "") === "") return only;
    return null;
  }

  function uniqueCodes(codes) {
    var seen = {};
    var out = [];
    for (var i = 0; i < codes.length; i++) {
      if (!seen[codes[i]]) {
        seen[codes[i]] = true;
        out.push(codes[i]);
      }
    }
    return out;
  }

  function parseHandoffCodePaste(raw) {
    var text = String(raw != null ? raw : "");
    if (!text.trim()) return { ok: false, reason: "" };

    var direct = directSixDigitCompact(text);
    if (direct) return { ok: true, code: direct };

    var labeled = collectColonLabeledCandidates(text);
    var uniq = uniqueCodes(labeled);
    if (uniq.length === 1) return { ok: true, code: uniq[0] };
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

  window.TanTrackerHandoffCodePaste = { parseHandoffCodePaste: parseHandoffCodePaste };
})();
