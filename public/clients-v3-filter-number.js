(function () {
  "use strict";

  var PLAIN_DECIMAL_FILTER_RE = /^-?\d+(\.\d+)?$/;
  var MAX_TOTAL_DIGITS = 40;
  var MAX_INPUT_CHARS = 80;
  var MAX_EXPONENT_MAG = 60;

  function digitCount(part) {
    return String(part).replace(/\D/g, "").length;
  }

  function safeRepeatZero(count) {
    if (count < 0 || count > MAX_TOTAL_DIGITS) {
      return null;
    }
    var out = "";
    for (var i = 0; i < count; i++) {
      out += "0";
    }
    return out;
  }

  function parseFiniteExponent(expStr) {
    if (!/^-?\d+$/.test(expStr)) {
      return null;
    }
    var unsigned = expStr.charAt(0) === "-" ? expStr.slice(1) : expStr;
    if (!unsigned || unsigned.length > 4) {
      return null;
    }
    var value = Number(expStr);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return null;
    }
    if (Math.abs(value) > MAX_EXPONENT_MAG) {
      return null;
    }
    return value;
  }

  function canonicalizePlainDecimal(raw) {
    var body = String(raw).trim();
    if (body.length > MAX_INPUT_CHARS) {
      return null;
    }
    var negative = false;
    if (body.charAt(0) === "-") {
      negative = true;
      body = body.slice(1);
    }
    if (!body || body === ".") {
      return null;
    }
    if (!/^\d*\.?\d*$/.test(body)) {
      return null;
    }
    var parts = body.split(".");
    if (parts.length > 2) {
      return null;
    }
    var intPart = parts[0] || "0";
    var fracPart = parts[1] || "";
    intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
    fracPart = fracPart.replace(/0+$/, "");
    if (digitCount(intPart) + digitCount(fracPart) > MAX_TOTAL_DIGITS) {
      return null;
    }
    var value = fracPart ? intPart + "." + fracPart : intPart;
    if (value === "0") {
      negative = false;
    }
    if (negative) {
      value = "-" + value;
    }
    return PLAIN_DECIMAL_FILTER_RE.test(value) ? value : null;
  }

  function expandScientificNotation(raw) {
    var trimmed = String(raw).trim();
    if (trimmed.length > MAX_INPUT_CHARS) {
      return { ok: false, reason: "invalid" };
    }
    var match = trimmed.match(/^(-?)(?:(\d+)(?:\.(\d*))?|\.(\d+))[eE]([+-]?\d+)$/);
    if (!match) {
      return { ok: false, reason: "invalid" };
    }
    var negative = match[1] === "-";
    var intPart = match[2] || "";
    var fracFromDot = match[3] != null ? match[3] : "";
    var fracOnly = match[4] || "";
    var exponent = parseFiniteExponent(match[5]);
    if (exponent === null) {
      return { ok: false, reason: "invalid" };
    }
    var digits = (intPart + fracFromDot) || fracOnly;
    if (!digits || !/^\d+$/.test(digits)) {
      return { ok: false, reason: "invalid" };
    }
    var decimalPos = intPart.length;
    var newPos = decimalPos + exponent;
    var intDigits;
    var fracDigits;
    if (newPos <= 0) {
      var leadZeros = -newPos;
      if (leadZeros + digitCount(digits) > MAX_TOTAL_DIGITS) {
        return { ok: false, reason: "invalid" };
      }
      var prefix = safeRepeatZero(leadZeros);
      if (prefix === null) {
        return { ok: false, reason: "invalid" };
      }
      var fracBody = (prefix + digits).replace(/0+$/, "");
      intDigits = "0";
      fracDigits = fracBody;
    } else {
      if (newPos > MAX_TOTAL_DIGITS + digitCount(digits)) {
        return { ok: false, reason: "invalid" };
      }
      var combined = digits;
      var pad = newPos - combined.length;
      if (pad > MAX_TOTAL_DIGITS) {
        return { ok: false, reason: "invalid" };
      }
      if (pad > 0) {
        var padZeros = safeRepeatZero(pad);
        if (padZeros === null) {
          return { ok: false, reason: "invalid" };
        }
        combined = combined + padZeros;
      }
      intDigits = combined.slice(0, newPos) || "0";
      fracDigits = combined.slice(newPos).replace(/0+$/, "");
    }
    if (digitCount(intDigits) + digitCount(fracDigits) > MAX_TOTAL_DIGITS) {
      return { ok: false, reason: "invalid" };
    }
    var value = fracDigits ? intDigits + "." + fracDigits : intDigits;
    value = value.replace(/^0+(?=\d)/, "") || "0";
    if (value === "0") {
      return { ok: true, value: "0" };
    }
    if (negative) {
      value = "-" + value;
    }
    if (!PLAIN_DECIMAL_FILTER_RE.test(value)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, value: value };
  }

  function normalizeListFilterNumberValue(raw) {
    var trimmed = String(raw == null ? "" : raw).trim();
    if (!trimmed || trimmed === "-") {
      return { ok: false, reason: "empty" };
    }
    if (trimmed.length > MAX_INPUT_CHARS) {
      return { ok: false, reason: "invalid" };
    }
    if (/^0[xX]/.test(trimmed)) {
      return { ok: false, reason: "invalid" };
    }
    if (/[eE]/.test(trimmed)) {
      return expandScientificNotation(trimmed);
    }
    var plain = canonicalizePlainDecimal(trimmed);
    if (!plain) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, value: plain };
  }

  window.ClientsV3FilterNumber = {
    normalizeListFilterNumberValue: normalizeListFilterNumberValue,
    PLAIN_DECIMAL_FILTER_RE: PLAIN_DECIMAL_FILTER_RE,
  };
})();
