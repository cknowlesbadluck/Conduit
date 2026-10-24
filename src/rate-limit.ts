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
    // Number.isFinite also rejects NaN, which would otherwise pass `< 1` and silently disable limiting.
    for (const value of [options.limit, options.windowMs, options.maxKeys]) {
      if (!Number.isFinite(value) || value < 1) throw new Error("invalid_rate_limit_options");
    }
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
      // Timestamps are inserted in non-decreasing order. Prune expired prefixes in place.
      let firstValid = 0;
      while (firstValid < timestamps.length && timestamps[firstValid] <= cutoff) {
        firstValid++;
      }
      if (firstValid > 0) timestamps.splice(0, firstValid);
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

  // Performance Optimization: Perform single-pass O(K) eviction sweep.
  // Immediately prunes expired buckets on the fly while tracking the oldest active key in
  // a single iteration over this.buckets. Avoids O(K log K) sorting and intermediate array/tuple
  // allocations from [...this.buckets.entries()].sort(...) when capacity maxKeys is exceeded.
  private evict(now: number) {
    if (this.buckets.size <= this.options.maxKeys) return;
    const cutoff = now - this.options.windowMs;

    while (this.buckets.size > this.options.maxKeys) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;

      for (const [key, timestamps] of this.buckets) {
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
          this.buckets.delete(key);
          if (this.buckets.size <= this.options.maxKeys) return;
        } else {
          const time = timestamps[0] ?? 0;
          if (time < oldestTime) {
            oldestTime = time;
            oldestKey = key;
          }
        }
      }

      if (this.buckets.size > this.options.maxKeys && oldestKey) {
        this.buckets.delete(oldestKey);
      } else {
        break;
      }
    }
  }
}

/**
 * Reads a positive integer from the environment. Missing, empty, non-numeric, non-finite or < 1 values
 * fall back to the default, so a typo can neither disable rate limiting (NaN) nor crash boot (0 / "").
 */
export function envPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

const env = (name: string, fallback: number) => envPositiveInt(process.env[name], fallback);

export const MCP_RATE_LIMITER = new SlidingWindowLimiter({
  limit: env("CONDUIT_RATE_LIMIT", 120),
  windowMs: env("CONDUIT_RATE_WINDOW_MS", 60_000),
  maxKeys: env("CONDUIT_RATE_MAX_KEYS", 10_000),
});

export const TOOL_RATE_LIMITER = new SlidingWindowLimiter({
  limit: env("CONDUIT_TOOL_RATE_LIMIT", 30),
  windowMs: env("CONDUIT_TOOL_RATE_WINDOW_MS", 60_000),
  maxKeys: env("CONDUIT_RATE_MAX_KEYS", 10_000),
});

export const EXTERNAL_RATE_LIMITER = new SlidingWindowLimiter({
  limit: env("CONDUIT_EXTERNAL_RATE_LIMIT", 20),
  windowMs: env("CONDUIT_EXTERNAL_RATE_WINDOW_MS", 60_000),
  maxKeys: env("CONDUIT_RATE_MAX_KEYS", 10_000),
});

// /diagnostics is unauthenticated and fans out to ~8 outbound fetches per call,
// so it gets a much tighter budget than MCP traffic.
export const DIAGNOSTICS_RATE_LIMITER = new SlidingWindowLimiter({
  limit: env("CONDUIT_DIAGNOSTICS_RATE_LIMIT", 10),
  windowMs: env("CONDUIT_DIAGNOSTICS_RATE_WINDOW_MS", 60_000),
  maxKeys: env("CONDUIT_RATE_MAX_KEYS", 10_000),
});
