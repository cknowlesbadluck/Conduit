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
    } else {
      // Timestamps are inserted in non-decreasing order. Prune expired prefixes in place.
      let firstValid = 0;
      while (firstValid < timestamps.length && timestamps[firstValid] <= cutoff) {
        firstValid++;
      }
      if (firstValid > 0) timestamps.splice(0, firstValid);
      // Delete existing entry so re-setting moves key to the back of Map insertion order (MRU).
      this.buckets.delete(key);
    }
    // Re-insert or insert key to maintain Map insertion order as LRU (least recently checked at front).
    this.buckets.set(key, timestamps);

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
    // Optimization: First pass removes empty/expired buckets.
    for (const [key, timestamps] of this.buckets) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) this.buckets.delete(key);
      if (this.buckets.size <= this.options.maxKeys) break;
    }
    // Optimization: JS Maps preserve insertion order. Because check() re-inserts keys on access,
    // keys in this.buckets are ordered from LRU to MRU. When maxKeys is still exceeded,
    // evict the oldest (LRU) keys directly from Map iterator without array allocations or O(N log N) sorting.
    if (this.buckets.size > this.options.maxKeys) {
      for (const key of this.buckets.keys()) {
        this.buckets.delete(key);
        if (this.buckets.size <= this.options.maxKeys) break;
      }
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
