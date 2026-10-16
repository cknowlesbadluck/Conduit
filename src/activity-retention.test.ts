import test from "node:test";
import assert from "node:assert/strict";
import { startActivityRetention, stopActivityRetention } from "./store.js";

test("activity retention: one unref'd timer, runs prune on interval, survives prune failures", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const prune = async () => { calls++; if (calls === 1) throw new Error("db blip"); };
  try {
    const timer = startActivityRetention({ intervalMs: 60_000, prune });
    assert.ok(timer);
    assert.equal(startActivityRetention({ intervalMs: 60_000, prune }), timer, "idempotent");
    t.mock.timers.tick(60_000); t.mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2, "kept running after a failed pass");
  } finally { stopActivityRetention(); }
});

test("activity retention: interval 0 disables; sub-minute intervals are clamped", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  try {
    assert.equal(startActivityRetention({ intervalMs: 0, prune: async () => { calls++; } }), undefined);
    startActivityRetention({ intervalMs: 1, prune: async () => { calls++; } });
    t.mock.timers.tick(59_999); assert.equal(calls, 0);
    t.mock.timers.tick(1); assert.equal(calls, 1);
  } finally { stopActivityRetention(); }
});
