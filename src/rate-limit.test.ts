import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowLimiter } from "./rate-limit.js";

test("sliding window allows the configured burst then rejects", () => {
  const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, maxKeys: 10 });
  assert.equal(limiter.check("agent_1").allowed, true);
  assert.equal(limiter.check("agent_1").allowed, true);
  assert.equal(limiter.check("agent_1").allowed, false);
});

test("rate limiter reports retry delay and expires old entries", () => {
  const now = { value: 0 };
  const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 100, maxKeys: 10, now: () => now.value });
  assert.equal(limiter.check("agent_1").allowed, true);
  const blocked = limiter.check("agent_1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 100);
  now.value = 101;
  assert.equal(limiter.check("agent_1").allowed, true);
});

test("rate limiter evicts idle keys when maxKeys is exceeded", () => {
  const now = { value: 0 };
  const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 100, maxKeys: 2, now: () => now.value });
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("b").allowed, true);
  now.value = 50;
  assert.equal(limiter.check("c").allowed, true);
  now.value = 151;
  assert.equal(limiter.check("c").allowed, true);
});

test("envPositiveInt falls back on missing, empty, NaN, non-finite and < 1 values", async () => {
  const { envPositiveInt } = await import("./rate-limit.js");
  assert.equal(envPositiveInt(undefined, 30), 30);
  assert.equal(envPositiveInt("", 30), 30);
  assert.equal(envPositiveInt("  ", 30), 30);
  assert.equal(envPositiveInt("abc", 30), 30);
  assert.equal(envPositiveInt("Infinity", 30), 30);
  assert.equal(envPositiveInt("0", 30), 30);
  assert.equal(envPositiveInt("-5", 30), 30);
  assert.equal(envPositiveInt("12.9", 30), 12);
  assert.equal(envPositiveInt("50", 30), 50);
});

test("SlidingWindowLimiter rejects NaN and non-finite options instead of disabling limiting", async () => {
  const { SlidingWindowLimiter } = await import("./rate-limit.js");
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new SlidingWindowLimiter({ limit: bad, windowMs: 1000, maxKeys: 10 }), /invalid_rate_limit_options/);
    assert.throws(() => new SlidingWindowLimiter({ limit: 5, windowMs: bad, maxKeys: 10 }), /invalid_rate_limit_options/);
    assert.throws(() => new SlidingWindowLimiter({ limit: 5, windowMs: 1000, maxKeys: bad }), /invalid_rate_limit_options/);
  }
});
