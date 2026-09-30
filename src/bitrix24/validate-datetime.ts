export type ParsedOptionalDate =
  | { kind: "absent" }
  | { kind: "valid"; value: string }
  | { kind: "invalid" };

const BITRIX_DATETIME_WITH_TZ =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const BITRIX_DATETIME_WITHOUT_TZ =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

function isValidCalendarParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute &&
    probe.getUTCSeconds() === second
  );
}

export function isValidTimezoneOffset(offset: string): boolean {
  if (offset === "Z") {
    return true;
  }
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    return false;
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return false;
  }
  if (minutes < 0 || minutes > 59) {
    return false;
  }
  if (hours < 0 || hours > 14) {
    return false;
  }
  if (hours === 14 && minutes !== 0) {
    return false;
  }
  return true;
}

function parseBitrixDateTime(trimmed: string): ParsedOptionalDate {
  const withTz = trimmed.match(BITRIX_DATETIME_WITH_TZ);
  if (withTz) {
    const timezone = withTz[8]!;
    if (!isValidTimezoneOffset(timezone)) {
      return { kind: "invalid" };
    }
    const year = Number(withTz[1]);
    const month = Number(withTz[2]);
    const day = Number(withTz[3]);
    const hour = Number(withTz[4]);
    const minute = Number(withTz[5]);
    const second = Number(withTz[6]);
    if (!isValidCalendarParts(year, month, day, hour, minute, second)) {
      return { kind: "invalid" };
    }
    return { kind: "valid", value: trimmed };
  }

  const withoutTz = trimmed.match(BITRIX_DATETIME_WITHOUT_TZ);
  if (withoutTz) {
    const year = Number(withoutTz[1]);
    const month = Number(withoutTz[2]);
    const day = Number(withoutTz[3]);
    const hour = Number(withoutTz[4]);
    const minute = Number(withoutTz[5]);
    const second = Number(withoutTz[6]);
    if (!isValidCalendarParts(year, month, day, hour, minute, second)) {
      return { kind: "invalid" };
    }
    return { kind: "valid", value: trimmed };
  }

  return { kind: "invalid" };
}

export function parseOptionalBitrixDate(value: unknown): ParsedOptionalDate {
  if (value === null || value === undefined) {
    return { kind: "absent" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "absent" };
  }
  return parseBitrixDateTime(trimmed);
}
