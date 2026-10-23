import test from "node:test";
import assert from "node:assert/strict";
import { observe, retryDelayMs } from "./portfolio-probe.mjs";

const res = (status, body) => ({ status, text: async () => body, headers: { get: () => null } });

test("retryDelayMs jitters within [base, 1.5*base) and clamps bad randoms", () => {
  assert.equal(retryDelayMs(2000, () => 0), 2000);
  assert.ok(retryDelayMs(2000, () => 0.999) < 3000);
  assert.equal(retryDelayMs(2000, () => NaN), 2000);
  assert.equal(retryDelayMs(2000, () => 5), retryDelayMs(2000, () => 0.999));
});

test("cold-start 503 retried exactly once with jittered sleep", async () => {
  let calls = 0; const sleeps = [];
  const out = await observe("https://x/ready", {
    fetchImpl: async () => (++calls === 1 ? res(503, "") : res(200, "{}")),
    sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5,
  });
  assert.equal(calls, 2); assert.equal(out.status, 200); assert.deepEqual(sleeps, [2500]);
});

test("owner-gate not_ready 503 is not retried", async () => {
  let calls = 0;
  const out = await observe("https://x/ready", {
    fetchImpl: async () => { calls++; return res(503, JSON.stringify({ status: "not_ready", missingRequired: ["K"] })); },
    sleep: async () => assert.fail("no sleep"),
  });
  assert.equal(calls, 1); assert.equal(out.status, 503);
});

test("retries capped at one even if caller asks for more", async () => {
  let calls = 0;
  const out = await observe("https://x/ready", { retries: 10, fetchImpl: async () => { calls++; return res(503, ""); }, sleep: async () => {} });
  assert.equal(calls, 2); assert.equal(out.status, 503);
});
