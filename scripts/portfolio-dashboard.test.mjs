import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboard, probeTarget, dashboardMarkdown, COLD_START_DELAYS_S } from "./portfolio-dashboard.mjs";
import { TARGETS } from "./portfolio-probe.mjs";

const conduit = TARGETS.find((t) => t.name === "conduit");
const readyBody = JSON.stringify({ status: "ready", service: "conduit", version: "0.8.0", contractRevision: "2026-10-03-ready-surface", persistence: "postgres", production: true });
const sum = (open, cands = []) => ({ open, overTarget: Math.max(0, open - 10), ownerOnly: null, closeCandidates: cands.map((number) => ({ number })) });
const okPlanes = [{ name: "conduit", outcome: "ready", ok: true }, { name: "resonance-netlify", outcome: "ready", ok: true }, { name: "resonance-vercel", outcome: "stranger_occupant", ok: false }];

test("ready only when every owned plane is ready and every repo answered; aliases are informational", () => {
  const d = buildDashboard({ planes: okPlanes, repos: { Conduit: sum(14, [120]), Resonance: sum(23) } });
  assert.equal(d.ready, true);
  assert.deepEqual(d.aliasOwnerCheck, [{ name: "resonance-vercel", outcome: "stranger_occupant", ours: false }]);
  assert.match(dashboardMarkdown(d), /READY/);
});

test("fail-closed: unready plane, missing plane, API error or no repos -> NOT READY", () => {
  assert.deepEqual(buildDashboard({ planes: [{ ...okPlanes[0], ok: false, outcome: "timeout" }, okPlanes[1]], repos: { C: sum(1) } }).problems, ["plane_not_ready:conduit:timeout"]);
  assert.deepEqual(buildDashboard({ planes: [okPlanes[0]], repos: { C: sum(1) } }).problems, ["plane_missing:resonance-netlify"]);
  const d = buildDashboard({ planes: okPlanes, repos: { C: null } });
  assert.deepEqual(d.problems, ["repo_unavailable:C"]);
  assert.match(dashboardMarkdown(d), /\| C \| unknown \| unknown \| unknown \| unknown \|/);
  assert.deepEqual(buildDashboard({ planes: okPlanes, repos: {} }).problems, ["no_repos"]);
  assert.equal(buildDashboard({}).ready, false);
});

test("Conduit cold start: retries on the 10/20/30/45 s schedule until ready; errors stay non-ready", async () => {
  const slept = [];
  let n = 0;
  const observeImpl = async () => (++n < 3 ? { status: 503, headers: {}, body: "" } : { status: 200, headers: {}, body: readyBody });
  const r = await probeTarget(conduit, { observeImpl, sleep: async (ms) => slept.push(ms), coldStart: true });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(slept, [10_000, 20_000]);
  const dead = await probeTarget(conduit, { observeImpl: async () => { throw new Error("boom"); }, sleep: async () => {}, coldStart: true });
  assert.equal(dead.ok, false);
  assert.equal(dead.attempts, 1 + COLD_START_DELAYS_S.length);
  const once = await probeTarget(conduit, { observeImpl: async () => ({ error: "timeout" }), sleep: async () => assert.fail("no retry"), coldStart: false });
  assert.equal(once.attempts, 1);
});

test("probeTarget applies the pinned schema: a ready status with a wrong-shaped body is not ready (review)", async () => {
  const res = TARGETS.find((t) => t.name === "resonance-netlify");
  const r = await probeTarget(res, { observeImpl: async () => ({ status: 200, body: JSON.stringify({ status: "ready", service: "resonance-nexus" }) }) });
  assert.equal(r.ok, false);
});
