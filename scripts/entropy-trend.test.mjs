import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { entropyTrend, DEFAULT_BASELINE } from "./entropy-trend.mjs";

const baseline = { counts: { A: 10, B: 5, C: 3 } };

test("entropyTrend: steady, shrank, grew", () => {
  const r = entropyTrend(baseline, { A: 13, B: 2, C: 7 }, 3);
  assert.deepEqual(r.rows.map((x) => x.status), ["steady", "shrank", "grew"]);
  assert.equal(r.ok, false);
});

test("entropyTrend: growth exactly at threshold passes", () => {
  assert.equal(entropyTrend(baseline, { A: 13, B: 8, C: 6 }, 3).ok, true);
});

test("entropyTrend: null/missing counts are unknown and never fail", () => {
  const r = entropyTrend(baseline, { A: null, B: 5 }, 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => x.status), ["unknown", "steady", "unknown"]);
});

test("entropyTrend: rejects invalid maxGrowth", () => {
  assert.throws(() => entropyTrend(baseline, {}, -1));
  assert.throws(() => entropyTrend(baseline, {}, Number.NaN));
});

test("committed baseline is well-formed", async () => {
  const b = JSON.parse(await readFile(DEFAULT_BASELINE, "utf8"));
  for (const v of Object.values(b.counts)) assert.ok(Number.isInteger(v) && v >= 0);
  assert.deepEqual(Object.keys(b.counts).sort(), ["Conduit", "QuicksilverV1", "Resonance"]);
});
