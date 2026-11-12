import test from "node:test";
import assert from "node:assert/strict";
import { retryStartup } from "./startup-retry.js";

test("retryStartup returns after a transient startup failure", async () => {
  let calls = 0;
  const delays: number[] = [];
  const value = await retryStartup("database", async () => {
    calls++;
    if (calls < 3) throw new Error("temporary connection timeout");
    return "ready";
  }, {
    attempts: 4,
    baseDelayMs: 25,
    maxDelayMs: 100,
    sleep: async (ms) => { delays.push(ms); },
    onRetry: () => {},
  });
  assert.equal(value, "ready");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [25, 50]);
});

test("retryStartup stops after the configured attempt bound and rethrows the last error", async () => {
  const failure = new Error("database unavailable");
  let calls = 0;
  const delays: number[] = [];
  await assert.rejects(
    retryStartup("database", async () => { calls++; throw failure; }, {
      attempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      sleep: async (ms) => { delays.push(ms); },
      onRetry: () => {},
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("retryStartup clamps invalid attempt and delay settings to safe finite values", async () => {
  let calls = 0;
  const delays: number[] = [];
  await assert.rejects(
    retryStartup("database", async () => { calls++; throw new Error("down"); }, {
      attempts: Number.NaN,
      baseDelayMs: -1,
      maxDelayMs: Number.NaN,
      sleep: async (ms) => { delays.push(ms); },
      onRetry: () => {},
    }),
  );
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});
