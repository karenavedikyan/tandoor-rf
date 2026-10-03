/** Optional fixed clock for integration tests (`WORK_QUEUE_FIXED_NOW_MS`). */
export function resolveWorkQueueNowMs(): number {
  const fixed = process.env.WORK_QUEUE_FIXED_NOW_MS?.trim();
  if (fixed && /^\d+$/.test(fixed)) {
    return Number(fixed);
  }
  return Date.now();
}
