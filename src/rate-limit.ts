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
    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    } else {
      // Performance Optimization: Re-insert key so JS Map iteration order reflects LRU (Least Recently Used) order.
      this.buckets.delete(key);
      this.buckets.set(key, timestamps);

      // Timestamps are inserted in non-decreasing order. Prune expired prefixes in place.
      let firstValid = 0;
      while (firstValid < timestamps.length && timestamps[firstValid] <= cutoff) {
        firstValid++;
      }
      if (firstValid > 0) {
        if (firstValid === timestamps.length) {
          timestamps.length = 0; // O(1) fast-path when all timestamps are expired
        } else {
          timestamps.splice(0, firstValid);
        }
      }
    }

    if (timestamps.length >= this.options.limit) {
      return { allowed: false, retryAfterMs: Math.max(1, timestamps[0] + this.options.windowMs - now) };
    }
    timestamps.push(now);
    this.evict(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  clear() {
    this.buckets.clear();
  }

  private evict(now: number) {
    if (this.buckets.size <= this.options.maxKeys) return;
    const cutoff = now - this.options.windowMs;

    // Performance Optimization: Single-pass eviction using Map insertion order.
    // Pass 1: Evict empty or expired buckets.
    for (const [key, timestamps] of this.buckets) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.buckets.delete(key);
      }
      if (this.buckets.size <= this.options.maxKeys) return;
    }

    // Pass 2: If maxKeys is still exceeded, evict LRU keys in Map iterator order without sorting O(K log K).
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (this.buckets.size <= this.options.maxKeys) break;
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
