(function (global) {
  "use strict";

  var MSK_OFFSET = "+03:00";

  function parseMskLocalInput(value) {
    if (!value || typeof value !== "string") return null;
    var trimmed = value.trim();
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
    if (!match) return null;
    var isoWithOffset =
      match[1] + "-" + match[2] + "-" + match[3] + "T" + match[4] + ":" + match[5] + ":00" + MSK_OFFSET;
    var date = new Date(isoWithOffset);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function formatMskDisplay(iso) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function isoToMskLocalInput(iso) {
    var date = new Date(iso);
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    function get(type) {
      var part = parts.find(function (p) {
        return p.type === type;
      });
      return part ? part.value : "00";
    }
    return get("year") + "-" + get("month") + "-" + get("day") + "T" + get("hour") + ":" + get("minute");
  }

  global.AccessDatetime = {
    parseMskLocalInput: parseMskLocalInput,
    formatMskDisplay: formatMskDisplay,
    isoToMskLocalInput: isoToMskLocalInput,
    MSK_LABEL: "Москва, МСК",
  };
})(window);
