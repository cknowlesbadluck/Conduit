import test from "node:test";
import assert from "node:assert/strict";
import { checkConsistency, parsePhases } from "./portfolio-consistency.mjs";

const conduit = { status: "ready", production: true, contractRevision: "2026-10-03-ready-surface" };
const resonance = { status: "ready", production: true, contractRevision: "2026-10-03-owner-gate", ownerActionRequired: false, ownerKeys: [], missingRequired: [] };
const md = (s1, s2, s3, s10 = "blocked") => [
  "| # | Phase | Exit criteria | Status |", "|---|---|---|---|",
  `| 1 | Contract consistency | both ready | [${s1}] note |`,
  `| 2 | Fail-closed edges | 401 | [${s2}] |`,
  `| 3 | PR entropy | <10 | [${s3}] 20 / 15 |`,
  `| 10 | 1.0 | all | [${s10}] CHR-55 |`].join("\n");
const live = (o = {}) => ({ conduit, resonance, unauthPostStatus: 400, openPrs: { A: 20, B: 15 }, ...o });

test("parsePhases reads number, name and status; garbage parses to []", () => {
  assert.deepEqual(parsePhases(md("passed", "in progress", "in progress")).map((p) => [p.n, p.status]), [[1, "passed"], [2, "in progress"], [3, "in progress"], [10, "blocked"]]);
  assert.deepEqual(parsePhases("nothing here"), []);
});

test("matching revisions, closed owner gate and honest statuses are consistent", () => {
  const k = checkConsistency({ live: live(), roadmap: md("passed", "in progress", "in progress") });
  assert.equal(k.consistent, true, k.problems.join());
  assert.deepEqual(k.stale, []);
});

test("a passed claim without evidence is a contradiction", () => {
  const k = checkConsistency({ live: live(), roadmap: md("passed", "passed", "passed", "passed") });
  assert.equal(k.consistent, false);
  assert.ok(k.problems.includes("phase_claim_contradicted:2"));
  assert.ok(k.problems.includes("phase_claim_contradicted:3"));
});

test("1.0 claimed passed while any other phase is not passed is a contradiction", () => {
  const k = checkConsistency({ live: live(), roadmap: md("passed", "in progress", "in progress", "passed") });
  assert.ok(k.problems.includes("phase_claim_contradicted:10"));
});

test("contract revision drift and an open owner gate fail", () => {
  const k = checkConsistency({ live: live({ conduit: { ...conduit, contractRevision: "new" }, resonance: { ...resonance, ownerKeys: ["X"] } }), roadmap: md("in progress", "in progress", "in progress") });
  assert.ok(k.problems.includes("contract_mismatch:conduit:new"));
  assert.ok(k.problems.includes("owner_gate_open_or_unknown:resonance"));
});

test("fail-closed: missing roadmap, unparseable roadmap, missing probes, unknown status", () => {
  assert.ok(checkConsistency({ live: live(), roadmap: null }).problems.includes("roadmap_unavailable"));
  assert.ok(checkConsistency({ live: live(), roadmap: "x" }).problems.includes("roadmap_unparseable"));
  const k = checkConsistency({ live: { unauthPostStatus: null, openPrs: {} }, roadmap: md("passed", "in progress", "in progress") });
  assert.ok(k.problems.includes("contract_mismatch:conduit:unavailable"));
  assert.ok(k.problems.includes("phase_claim_contradicted:1"));
  assert.ok(checkConsistency({ live: live(), roadmap: "| # | Phase | Exit | Status |\n|---|---|---|---|\n| 4 | Main | x | [someday] |" }).problems.includes("phase_status_unknown:4"));
});

test("evidence that passes while the doc lags is stale, not a failure", () => {
  const k = checkConsistency({ live: live({ unauthPostStatus: 401 }), roadmap: md("passed", "in progress", "in progress") });
  assert.equal(k.consistent, true);
  assert.deepEqual(k.stale, ["phase_2_evidence_passes_but_doc_says_in_progress"]);
});

test("only the first current phases table is read; later historical tables are ignored", () => {
  const doc = md("passed", "in progress", "in progress") + "\n\nold:\n\n| # | Phase | Exit | Status |\n|---|---|---|---|\n| 1 | Old | x | [blocked] |";
  assert.deepEqual(parsePhases(doc).map((p) => p.n), [1, 2, 3, 10]);
});
