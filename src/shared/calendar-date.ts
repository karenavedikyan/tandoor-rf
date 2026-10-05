export type CalendarDateParseResult =
  | { ok: true; isoDate: string }
  | { ok: false; code: "INVALID_TYPE" | "INVALID_DATE_FORMAT" | "EMPTY" };

function isValidCalendarParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

/** Parse a calendar date without timezone (1C roster / assumption dates). */
export function parseCalendarDateInput(value: unknown): CalendarDateParseResult {
  if (value === null || value === undefined) {
    return { ok: false, code: "EMPTY" };
  }
  if (typeof value !== "string") {
    return { ok: false, code: "INVALID_TYPE" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "EMPTY" };
  }

  if (/[Zz]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return { ok: false, code: "INVALID_DATE_FORMAT" };
  }

  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3]);
    if (!isValidCalendarParts(year, month, day)) {
      return { ok: false, code: "INVALID_DATE_FORMAT" };
    }
    const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { ok: true, isoDate };
  }

  const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (dateTimeMatch) {
    const [, datePart, hour, minute, second] = dateTimeMatch;
    if (
      !isValidCalendarParts(
        Number(datePart!.slice(0, 4)),
        Number(datePart!.slice(5, 7)),
        Number(datePart!.slice(8, 10)),
      ) ||
      Number(hour) > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59
    ) {
      return { ok: false, code: "INVALID_DATE_FORMAT" };
    }
    return { ok: true, isoDate: datePart! };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(5, 7));
    const day = Number(trimmed.slice(8, 10));
    if (!isValidCalendarParts(year, month, day)) {
      return { ok: false, code: "INVALID_DATE_FORMAT" };
    }
    return { ok: true, isoDate: trimmed };
  }

  return { ok: false, code: "INVALID_DATE_FORMAT" };
}

/** Store calendar dates at UTC noon to avoid local timezone day shifts. */
export function calendarDateToTimestamptz(isoDate: string): string {
  return `${isoDate}T12:00:00.000Z`;
}

export function formatCalendarDateFromTimestamptz(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}
