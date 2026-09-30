import { bitrixChangedAtToDate } from "../parse-changed-at";

export type TimestampGuardResult = { ok: true } | { ok: false; reason: "invalid" | "future" };

export function guardPastTimestamp(raw: string | null | undefined, nowMs = Date.now()): TimestampGuardResult {
  if (!raw) {
    return { ok: false, reason: "invalid" };
  }
  const parsed = bitrixChangedAtToDate(raw) ?? new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.getTime() > nowMs) {
    return { ok: false, reason: "future" };
  }
  return { ok: true };
}
