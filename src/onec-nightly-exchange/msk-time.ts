export type MoscowWallClock = {
  /** YYYY-MM-DD in Europe/Moscow */
  dateKey: string;
  minutesSinceMidnight: number;
};

export type NightlyWindowBounds = {
  /** MSK calendar date when the window starts (stable key across midnight span). */
  windowKey: string;
  startAt: Date;
  /** Exclusive end instant (UTC). */
  deadlineAt: Date;
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

export function previousMoscowDateKey(dateKey: string): string {
  const start = mskDateKeyToInstant(dateKey, 0, 0);
  const previous = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  return getMoscowWallClock(previous).dateKey;
}

export function parseScheduleMinutes(scheduleTime: string): number {
  const [hourRaw, minuteRaw] = scheduleTime.split(":");
  const hour = Number.parseInt(hourRaw ?? "0", 10);
  const minute = Number.parseInt(minuteRaw ?? "0", 10);
  return hour * 60 + minute;
}

export function mskDateKeyToInstant(dateKey: string, hour: number, minute: number): Date {
  return new Date(
    `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`,
  );
}

export function windowBoundsForStartDate(
  startDateKey: string,
  scheduleTime: string,
  windowMinutes: number,
): NightlyWindowBounds {
  const startMinutes = parseScheduleMinutes(scheduleTime);
  const startHour = Math.floor(startMinutes / 60);
  const startMinute = startMinutes % 60;
  const startAt = mskDateKeyToInstant(startDateKey, startHour, startMinute);
  const deadlineAt = new Date(startAt.getTime() + windowMinutes * 60_000);
  return {
    windowKey: startDateKey,
    startAt,
    deadlineAt,
  };
}

/** Active window if any; midnight-spanning windows keep the start-date key. */
export function resolveActiveNightlyWindow(input: {
  now: Date;
  scheduleTime: string;
  windowMinutes: number;
}): NightlyWindowBounds | null {
  const todayKey = getMoscowWallClock(input.now).dateKey;
  const candidateKeys = [todayKey, previousMoscowDateKey(todayKey)];
  for (const startDateKey of candidateKeys) {
    const bounds = windowBoundsForStartDate(
      startDateKey,
      input.scheduleTime,
      input.windowMinutes,
    );
    if (input.now >= bounds.startAt && input.now < bounds.deadlineAt) {
      return bounds;
    }
  }
  return null;
}

export function isWithinNightlyWindow(input: {
  now: Date;
  scheduleTime: string;
  windowMinutes: number;
}): boolean {
  return resolveActiveNightlyWindow(input) != null;
}

/** @deprecated Prefer resolveActiveNightlyWindow().windowKey */
export function nightlyWindowKey(now: Date): string {
  return getMoscowWallClock(now).dateKey;
}
