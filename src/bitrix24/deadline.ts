export type SleepFn = (ms: number) => Promise<void>;

export class OperationDeadline {
  constructor(
    private readonly expiresAtMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleepFn: SleepFn = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  ) {}

  static fromDuration(
    maxTotalDurationMs: number,
    startedAtMs = Date.now(),
    sleepFn?: SleepFn,
  ): OperationDeadline {
    return new OperationDeadline(startedAtMs + maxTotalDurationMs, Date.now, sleepFn);
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAtMs - this.now());
  }

  expired(): boolean {
    return this.remainingMs() <= 0;
  }

  async sleep(ms: number): Promise<boolean> {
    const allowed = Math.min(ms, this.remainingMs());
    if (allowed <= 0) {
      return false;
    }
    await this.sleepFn(allowed);
    return !this.expired();
  }
}
