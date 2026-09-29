export class OperationDeadline {
  constructor(
    private readonly expiresAtMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  static fromDuration(maxTotalDurationMs: number, startedAtMs = Date.now()): OperationDeadline {
    return new OperationDeadline(startedAtMs + maxTotalDurationMs);
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
    await new Promise<void>((resolve) => {
      setTimeout(resolve, allowed);
    });
    return !this.expired();
  }
}
