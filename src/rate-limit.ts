type RateLimitOptions = {
  limit: number;
  windowMs: number;
  maxKeys: number;
  now?: () => number;
};

type Bucket = number[];

export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    if (options.limit < 1 || options.windowMs < 1 || options.maxKeys < 1) throw new Error("invalid_rate_limit_options");
    this.now = options.now ?? (() => Date.now());
  }

  check(key: string) {
    const now = this.now();
    const cutoff = now - this.options.windowMs;
    const existing = this.buckets.get(key) ?? [];
    const current = existing.filter((timestamp) => timestamp > cutoff);
    if (current.length >= this.options.limit) {
      this.buckets.set(key, current);
      return { allowed: false, retryAfterMs: Math.max(1, current[0] + this.options.windowMs - now) };
    }
    current.push(now);
    this.buckets.set(key, current);
    this.evict(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  clear() {
    this.buckets.clear();
  }

  private evict(now: number) {
    if (this.buckets.size <= this.options.maxKeys) return;
    const cutoff = now - this.options.windowMs;
    for (const [key, timestamps] of this.buckets) {
      if (timestamps.every((timestamp) => timestamp <= cutoff)) this.buckets.delete(key);
      if (this.buckets.size <= this.options.maxKeys) break;
    }
    if (this.buckets.size > this.options.maxKeys) {
      const oldest = [...this.buckets.entries()].sort((a, b) => (a[1][0] ?? 0) - (b[1][0] ?? 0));
      for (const [key] of oldest.slice(0, this.buckets.size - this.options.maxKeys)) this.buckets.delete(key);
    }
  }
}

export const MCP_RATE_LIMITER = new SlidingWindowLimiter({
  limit: Number(process.env.CONDUIT_RATE_LIMIT ?? 120),
  windowMs: Number(process.env.CONDUIT_RATE_WINDOW_MS ?? 60_000),
  maxKeys: Number(process.env.CONDUIT_RATE_MAX_KEYS ?? 10_000),
});

export const TOOL_RATE_LIMITER = new SlidingWindowLimiter({
  limit: Number(process.env.CONDUIT_TOOL_RATE_LIMIT ?? 30),
  windowMs: Number(process.env.CONDUIT_TOOL_RATE_WINDOW_MS ?? 60_000),
  maxKeys: Number(process.env.CONDUIT_RATE_MAX_KEYS ?? 10_000),
});

export const EXTERNAL_RATE_LIMITER = new SlidingWindowLimiter({
  limit: Number(process.env.CONDUIT_EXTERNAL_RATE_LIMIT ?? 20),
  windowMs: Number(process.env.CONDUIT_EXTERNAL_RATE_WINDOW_MS ?? 60_000),
  maxKeys: Number(process.env.CONDUIT_RATE_MAX_KEYS ?? 10_000),
});
