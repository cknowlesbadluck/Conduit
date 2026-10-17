import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry, readPositiveInt, RETRYABLE_STATUSES } from "./fetch-retry.mjs";

const noSleep = async () => {};
const res = (status) => ({ status });

function scripted(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return res(step);
  };
  return { fetchImpl, calls };
}

test("returns the first response when it is not retryable", async () => {
  const { fetchImpl, calls } = scripted([200]);
  const r = await fetchWithRetry("https://x/health", {}, { fetchImpl, sleep: noSleep });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].init.signal instanceof AbortSignal, "each attempt carries a timeout signal");
});

test("cold start: retries timeouts and 502/503 then succeeds", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const { fetchImpl, calls } = scripted([timeout, 502, 503, 200]);
  const retries = [];
  const r = await fetchWithRetry("https://x/health", {}, { fetchImpl, sleep: noSleep, attempts: 4, onRetry: (e) => retries.push(e.attempt) });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(retries, [1, 2, 3]);
});

test("never retries or masks real failures (401/404/500)", async () => {
  for (const status of [401, 404, 500]) {
    const { fetchImpl, calls } = scripted([status, 200]);
    const r = await fetchWithRetry("https://x/mcp", {}, { fetchImpl, sleep: noSleep });
    assert.equal(r.status, status);
    assert.equal(calls.length, 1, `status ${status} must not be retried`);
  }
});

test("returns the last retryable response when attempts run out (caller decides)", async () => {
  const { fetchImpl, calls } = scripted([503]);
  const r = await fetchWithRetry("https://x/ready", {}, { fetchImpl, sleep: noSleep, attempts: 3 });
  assert.equal(r.status, 503);
  assert.equal(calls.length, 3);
});

test("throws with context after persistent network errors", async () => {
  const { fetchImpl, calls } = scripted([new Error("ECONNRESET")]);
  await assert.rejects(
    fetchWithRetry("https://x/health", {}, { fetchImpl, sleep: noSleep, attempts: 2 }),
    /unreachable after 2 attempts: ECONNRESET/,
  );
  assert.equal(calls.length, 2);
});

test("linear backoff between attempts", async () => {
  const waits = [];
  const { fetchImpl } = scripted([503, 503, 200]);
  await fetchWithRetry("https://x", {}, { fetchImpl, attempts: 3, backoffMs: 100, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [100, 200]);
});

test("readPositiveInt falls back on junk", () => {
  assert.equal(readPositiveInt("45000", 1), 45000);
  for (const junk of [undefined, "", "abc", "-5", "0", "NaN", "Infinity"]) assert.equal(readPositiveInt(junk, 7), 7, String(junk));
  assert.deepEqual([...RETRYABLE_STATUSES].sort(), [502, 503, 504]);
});
