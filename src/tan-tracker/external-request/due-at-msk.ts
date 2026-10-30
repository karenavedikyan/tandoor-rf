import { getMoscowWallClock, mskDateKeyToInstant } from "../../onec-nightly-exchange/msk-time";

export type ExternalRequestDueMode = "today" | "tomorrow";

/** End of selected calendar day in Europe/Moscow (23:59), stored as UTC instant. */
export function externalRequestDueAtFromMode(
  mode: ExternalRequestDueMode | undefined,
  now: Date = new Date(),
): Date | null {
  if (!mode) return null;
  let dateKey = getMoscowWallClock(now).dateKey;
  if (mode === "tomorrow") {
    const endToday = mskDateKeyToInstant(dateKey, 23, 59);
    dateKey = getMoscowWallClock(new Date(endToday.getTime() + 60_000)).dateKey;
  }
  return mskDateKeyToInstant(dateKey, 23, 59);
}
