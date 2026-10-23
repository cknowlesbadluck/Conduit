import test from "node:test";
import assert from "node:assert/strict";
import { openPrEntropy, prEntropy } from "./portfolio-probe.mjs";

const now = Date.parse("2026-10-23T10:00:00Z");
const ago = (d) => new Date(now - d * 86_400_000).toISOString();
const pr = (number, days, head, base = "main") => ({ number, created_at: ago(days), head: { ref: head }, base: { ref: base } });

test("prEntropy: age buckets and oldest", () => {
  const r = prEntropy([pr(1, 0.5, "a"), pr(2, 3, "b"), pr(3, 10, "c"), pr(4, 45, "d")], now);
  assert.deepEqual(r.ageBuckets, { lt1d: 1, d1to7: 1, d7to30: 1, gt30d: 1 });
  assert.equal(r.oldestDays, 45);
  assert.equal(r.open, 4);
});

test("prEntropy: stacked depth follows base->head chains", () => {
  const r = prEntropy([pr(1, 1, "a"), pr(2, 1, "b", "a"), pr(3, 1, "c", "b"), pr(4, 1, "d")], now);
  assert.equal(r.maxStackDepth, 2);
  assert.equal(r.stacked, 2);
});

test("prEntropy: cycles terminate; empty input is zero", () => {
  assert.equal(prEntropy([pr(1, 1, "a", "b"), pr(2, 1, "b", "a")], now).maxStackDepth, 1);
  assert.deepEqual(prEntropy([], now), { open: 0, ageBuckets: { lt1d: 0, d1to7: 0, d7to30: 0, gt30d: 0 }, oldestDays: null, stacked: 0, maxStackDepth: 0, drafts: 0 });
});

test("openPrEntropy: fail-closed null on error, non-ok, or truncated page; no credentials sent", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init); if (url.includes("/Bad/")) throw new Error("boom"); if (url.includes("/Full/")) return { ok: true, json: async () => Array(100).fill(pr(1, 1, "x")) }; return { ok: url.includes("/Good/"), json: async () => [pr(1, 2, "a")] }; };
  const r = await openPrEntropy({ repos: ["Good", "Bad", "Nope", "Full"], fetchImpl, now });
  assert.equal(r.Good.open, 1);
  assert.equal(r.Bad, null); assert.equal(r.Nope, null); assert.equal(r.Full, null);
  for (const init of calls) assert.equal(init.headers.Authorization, undefined);
});

test("prEntropy: fork head with same ref name as upstream base is not a stack parent", () => {
  const up = { full_name: "o/r" }, fork = { full_name: "f/r" };
  const prs = [
    { number: 1, created_at: ago(1), head: { ref: "main", repo: fork }, base: { ref: "main", repo: up } },
    { number: 2, created_at: ago(1), head: { ref: "x", repo: up }, base: { ref: "main", repo: up } },
  ];
  assert.equal(prEntropy(prs, now).maxStackDepth, 0);
});

test("prEntropy counts draft PRs (only explicit draft === true)", async () => {
  const { prEntropy } = await import("./portfolio-probe.mjs");
  const now = Date.parse("2026-10-23T00:00:00Z");
  const pr = (number, draft) => ({ number, draft, created_at: "2026-10-22T00:00:00Z", base: { ref: "main" }, head: { ref: `b${number}` } });
  assert.equal(prEntropy([pr(1, true), pr(2, false), pr(3, undefined)], now).drafts, 1);
  assert.equal(prEntropy([], now).drafts, 0);
});
