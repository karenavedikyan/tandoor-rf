export type MoscowWallClock = {
  /** YYYY-MM-DD in Europe/Moscow */
  dateKey: string;
  minutesSinceMidnight: number;
};

function readMoscowParts(now: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function getMoscowWallClock(now: Date): MoscowWallClock {
  const parts = readMoscowParts(now);
  const hour = Number.parseInt(parts.hour, 10);
  const minute = Number.parseInt(parts.minute, 10);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

export function parseScheduleMinutes(scheduleTime: string): number {
  const [hourRaw, minuteRaw] = scheduleTime.split(":");
  const hour = Number.parseInt(hourRaw ?? "0", 10);
  const minute = Number.parseInt(minuteRaw ?? "0", 10);
  return hour * 60 + minute;
}

export function isWithinNightlyWindow(input: {
  now: Date;
  scheduleTime: string;
  windowMinutes: number;
}): boolean {
  const wall = getMoscowWallClock(input.now);
  const start = parseScheduleMinutes(input.scheduleTime);
  const end = start + input.windowMinutes;
  return wall.minutesSinceMidnight >= start && wall.minutesSinceMidnight < end;
}

export function nightlyWindowKey(now: Date): string {
  return getMoscowWallClock(now).dateKey;
}
