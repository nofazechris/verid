export interface RateLimitResult {
  ok: boolean;
  /** Seconds until a retry can succeed (when !ok). */
  retryAfter: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): RateLimitResult;
}

/**
 * Fixed-window in-memory limiter. Correct for a single process (dev, tests,
 * one instance). For multiple instances swap in a shared store (Redis/Upstash)
 * behind the same interface — it is injected via Deps.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const t = this.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    }
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + windowMs });
      return { ok: true, retryAfter: 0 };
    }
    cur.count++;
    return cur.count > limit ? { ok: false, retryAfter: Math.max(1, Math.ceil((cur.resetAt - t) / 1000)) } : { ok: true, retryAfter: 0 };
  }
}
