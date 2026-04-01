export class SlidingWindowRateLimiter {
  private readonly timestamps: number[] = []

  constructor(private readonly maxPerMinute: number) {}

  async waitForSlot(): Promise<void> {
    const now = Date.now()
    const cutoff = now - 60_000

    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift()
    }

    if (this.timestamps.length < this.maxPerMinute) {
      this.timestamps.push(now)
      return
    }

    const oldest = this.timestamps[0]
    const waitMs = Math.max(0, oldest + 60_000 - now)
    await Bun.sleep(waitMs)
    return this.waitForSlot()
  }
}
