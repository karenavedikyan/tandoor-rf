export type ExpectedDateParseResult =
  | { ok: true; iso: string; expired: boolean; raw: string }
  | { ok: false; raw: string };

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Parse DD.MM.YYYY HH:MM:SS without assuming a business timezone. */
export function parseExpectedDate(raw: string, now = new Date()): ExpectedDateParseResult {
  const trimmed = raw.trim();
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return { ok: false, raw: trimmed };
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return { ok: false, raw: trimmed };
  }
  const iso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}Z`;
  return { ok: true, iso, expired: utcMs < now.getTime(), raw: trimmed };
}
