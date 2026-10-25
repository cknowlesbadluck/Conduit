import test from "node:test";
import assert from "node:assert/strict";
import { portfolioScore, portfolioScoreBreakdown, scoreBreakdownTable, SCORE_POINTS, UNOWNED_TARGETS, TARGETS } from "./portfolio-probe.mjs";

// 2026-10-25 02:00 ET snapshot that produced 2.7/10: Conduit cold 503, Resonance ready, 4 alias rows.
const snap = [
  { name: "conduit", outcome: "unreachable", ok: false },
  { name: "resonance-netlify", outcome: "ready", ok: true },
  { name: "resonance-vercel", outcome: "stranger_occupant", ok: false },
  { name: "resonancenexus-vercel", outcome: "alias_absent", ok: false },
  { name: "quicksilver-vercel", outcome: "stranger_occupant", ok: false },
  { name: "quicksilverv1-vercel", outcome: "alias_absent", ok: false },
];

test("breakdown explains 2.7: contributions sum to score", () => {
  const bd = portfolioScoreBreakdown(snap);
  assert.equal(bd.score, 2.7);
  assert.equal(bd.targets, 6);
  assert.deepEqual(bd.rows.map((r) => r.points), [2, 10, 1, 1, 1, 1]);
  assert.equal(bd.byFactor.ready.contribution, 1.67);
  assert.equal(bd.byFactor.other_not_ok.count, 1);
  assert.equal(bd.byFactor.stranger_occupant.count + bd.byFactor.alias_absent.count, 4);
  const sum = bd.rows.reduce((a, r) => a + r.contribution, 0);
  assert.ok(Math.abs(sum - 16 / 6) < 0.02);
});
test("portfolioScore unchanged and equals breakdown score", () => {
  assert.equal(portfolioScore(snap), 2.7);
  assert.equal(portfolioScore([{ outcome: "ready", ok: true }]), 10);
  assert.equal(portfolioScore([{ outcome: "not_ready", reason: "known_owner_gate" }]), SCORE_POINTS.known_owner_gate);
});
test("fail-closed on empty / malformed input", () => {
  for (const x of [undefined, null, [], "x"]) assert.equal(portfolioScoreBreakdown(x).score, 0);
  assert.equal(portfolioScoreBreakdown([null]).rows[0].factor, "other_not_ok:unknown");
});
test("text table lists every target and total", () => {
  const t = scoreBreakdownTable(portfolioScoreBreakdown(snap));
  assert.match(t, /resonance-netlify\s+ready\s+ready\s+10/);
  assert.match(t, /2\.7 \/10 \(mean of 6\)/);
  assert.equal(t.split("\n").length, 8);
});

test("ownedOnly: unowned Vercel aliases are informational and excluded from the mean", () => {
  const bd = portfolioScoreBreakdown(snap, { ownedOnly: true });
  assert.equal(bd.targets, 2);
  assert.equal(bd.score, 6); // (2 + 10) / 2
  assert.equal(bd.rows.filter((r) => r.factor === "informational").length, 4);
  assert.ok(bd.rows.filter((r) => r.factor === "informational").every((r) => r.weight === 0 && r.contribution === 0));
  assert.equal(bd.byFactor.alias_absent, undefined);
  assert.match(scoreBreakdownTable(bd), /6\.0 \/10 \(mean of 2 owned\)/);
});
test("ownedOnly: both owned planes ready scores 10 regardless of alias drift", () => {
  const warm = snap.map((r) => (r.name === "conduit" ? { ...r, outcome: "ready", ok: true } : r));
  assert.equal(portfolioScore(warm, { ownedOnly: true }), 10);
  assert.equal(portfolioScore(warm), 4); // legacy all-target mean unchanged: (10+10+1+1+1+1)/6 = 4.0
});
test("ownedOnly: UNOWNED_TARGETS is exactly the four Vercel aliases and owned targets stay scored", () => {
  assert.deepEqual([...UNOWNED_TARGETS].sort(), ["quicksilver-vercel", "quicksilverv1-vercel", "resonance-vercel", "resonancenexus-vercel"]);
  assert.ok(TARGETS.filter((t) => t.owned !== false).map((t) => t.name).includes("conduit"));
  assert.equal(portfolioScoreBreakdown([{ name: "resonance-vercel", outcome: "alias_absent" }], { ownedOnly: true }).score, 0); // fail-closed: nothing owned
});
