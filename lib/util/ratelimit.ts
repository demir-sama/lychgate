/** Fixed-window per-key rate limiter (per serverless instance; best effort). */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}
  check(key: string, now = Date.now()): { ok: boolean; retryAfterS: number } {
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return { ok: true, retryAfterS: 0 };
    }
    if (h.n >= this.limit) return { ok: false, retryAfterS: Math.ceil((h.reset - now) / 1000) };
    h.n++;
    return { ok: true, retryAfterS: 0 };
  }
}
