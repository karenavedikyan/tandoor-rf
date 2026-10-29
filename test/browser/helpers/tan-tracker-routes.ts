/** Canonical LK Tan Tracker deep link (readUrl only reads location.hash). */
export function tanTrackerLkHashPath(params: Record<string, string>): string {
  return `/tan-tracker#tan-tracker?${new URLSearchParams(params).toString()}`;
}

export function tanTrackerLkDetailPath(publicCode: string): string {
  return tanTrackerLkHashPath({ tt_screen: "detail", tt_order: publicCode });
}
