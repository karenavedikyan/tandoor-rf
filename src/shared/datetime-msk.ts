const MSK_OFFSET = "+03:00";

/** Parse datetime-local value as Europe/Moscow wall time → ISO UTC string. */
export function parseMskLocalInput(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match;
  const isoWithOffset = `${year}-${month}-${day}T${hour}:${minute}:00${MSK_OFFSET}`;
  const date = new Date(isoWithOffset);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/** Format instant for display in Europe/Moscow. */
export function formatMskDisplay(iso: string | Date | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
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

/** Convert ISO UTC to datetime-local string in MSK for form inputs. */
export function isoToMskLocalInput(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
