export type ExpectedCalendarParts = {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  raw: string;
};

export type ExpectedDateParseResult =
  | { ok: true; parts: ExpectedCalendarParts; expired: boolean }
  | { ok: false; raw: string };

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Parse DD.MM.YYYY HH:MM:SS without attaching a timezone. */
export function parseExpectedCalendar(raw: string): ExpectedDateParseResult | { ok: false; raw: string } {
  const trimmed = raw.trim();
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return { ok: false, raw: trimmed };
  }
  const parts: ExpectedCalendarParts = {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    raw: trimmed,
  };
  if (!isValidCalendar(parts)) {
    return { ok: false, raw: trimmed };
  }
  return { ok: true, parts, expired: false };
}

function isValidCalendar(parts: ExpectedCalendarParts): boolean {
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  return (
    probe.getUTCFullYear() === parts.year &&
    probe.getUTCMonth() === parts.month - 1 &&
    probe.getUTCDate() === parts.day &&
    probe.getUTCHours() === parts.hour &&
    probe.getUTCMinutes() === parts.minute &&
    probe.getUTCSeconds() === parts.second
  );
}

/** Compare calendar tuples only; reference date comes from import readAt (UTC date parts). */
export function isExpectedCalendarExpired(
  parts: ExpectedCalendarParts,
  reference = new Date(),
): boolean {
  const refYear = reference.getUTCFullYear();
  const refMonth = reference.getUTCMonth() + 1;
  const refDay = reference.getUTCDate();
  if (parts.year !== refYear) return parts.year < refYear;
  if (parts.month !== refMonth) return parts.month < refMonth;
  if (parts.day !== refDay) return parts.day < refDay;
  return false;
}

export function formatExpectedCalendar(parts: ExpectedCalendarParts): string {
  return `${pad2(parts.day)}.${pad2(parts.month)}.${parts.year} ${parts.hour}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

export function markExpectedCalendarExpiry(
  parsed: { ok: true; parts: ExpectedCalendarParts; expired: boolean },
  reference = new Date(),
): { ok: true; parts: ExpectedCalendarParts; expired: boolean } {
  return {
    ok: true,
    parts: parsed.parts,
    expired: isExpectedCalendarExpired(parsed.parts, reference),
  };
}
