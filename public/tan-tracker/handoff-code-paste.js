(function () {
  "use strict";

  var CODE_LABEL =
    /(?:код(?:\s+при[её]ма)?(?:\s+для\s+передачи)?|handoff\s+code|one-time\s+code)/i;

  function isStandaloneSixDigits(match, text, index) {
    var before = index > 0 ? text[index - 1] : "";
    var after = index + match.length < text.length ? text[index + match.length] : "";
    if (before >= "0" && before <= "9") return false;
    if (after >= "0" && after <= "9") return false;
    return true;
  }

  function collectLabeledCandidates(text) {
    var found = [];
    var searchFrom = 0;
    while (searchFrom < text.length) {
      var slice = text.slice(searchFrom);
      var labelMatch = slice.match(CODE_LABEL);
      if (!labelMatch || labelMatch.index == null) break;
      var afterLabel = searchFrom + labelMatch.index + labelMatch[0].length;
      var windowText = text.slice(afterLabel, afterLabel + 160);
      var digitRe = /(?<![0-9])(\d{6})(?![0-9])/g;
      var m;
      while ((m = digitRe.exec(windowText))) {
        var abs = afterLabel + m.index;
        if (isStandaloneSixDigits(m[1], text, abs)) found.push(m[1]);
      }
      searchFrom = afterLabel + 1;
    }
    if (found.length) return found;
    var colonRe = /код(?:\s+для\s+передачи)?[^:\n]{0,100}:\s*(?<![0-9])(\d{6})(?![0-9])/gi;
    var cm;
    while ((cm = colonRe.exec(text))) {
      if (cm[1]) found.push(cm[1]);
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

    var labeled = collectLabeledCandidates(text);
    var uniq = uniqueCodes(labeled);
    if (uniq.length === 1) return { ok: true, code: uniq[0] };
    if (uniq.length > 1) {
      return {
        ok: false,
        ambiguous: true,
        reason: "В тексте несколько разных кодов. Скопируйте только одно сообщение с кодом.",
      };
    }

    var loose = [];
    var looseRe = /(?<![0-9])(\d{6})(?![0-9])/g;
    var lm;
    while ((lm = looseRe.exec(text))) loose.push(lm[1]);
    var looseUniq = uniqueCodes(loose);
    if (looseUniq.length === 1 && CODE_LABEL.test(text)) return { ok: true, code: looseUniq[0] };
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

  window.TanTrackerHandoffCodePaste = { parseHandoffCodePaste: parseHandoffCodePaste };
})();
