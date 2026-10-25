import test from "node:test";
import assert from "node:assert/strict";
import { isDocsOnly, ciState, classifyPr, summarizeRepo, hygieneMarkdown, fetchOpenPrs } from "./pr-hygiene.mjs";

const NOW = Date.parse("2026-10-25T15:00:00Z");
const pr = (o) => ({ number: 1, title: "feat: x", headRefName: "feat/x", baseRefName: "main", isDraft: false, mergeable: "MERGEABLE", reviewDecision: "", createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z", files: [{ path: "src/a.ts" }], statusCheckRollup: [{ name: "verify", status: "COMPLETED", conclusion: "SUCCESS", completedAt: "2026-10-24T00:00:00Z" }], ...o });

test("docs-only detection is fail-closed on empty file lists", () => {
  assert.equal(isDocsOnly([{ path: "docs/A.md" }, { path: "README.md" }]), true);
  assert.equal(isDocsOnly([{ path: "docs/A.md" }, { path: "src/a.ts" }]), false);
  assert.equal(isDocsOnly([]), false);
  assert.equal(isDocsOnly(undefined), false);
});

test("ciState ignores Workers Builds and uses the latest run per check", () => {
  assert.equal(ciState([{ name: "Workers Builds: conduit", status: "COMPLETED", conclusion: "FAILURE" }, { name: "verify", status: "COMPLETED", conclusion: "SUCCESS" }]), "green");
  assert.equal(ciState([{ name: "verify", status: "COMPLETED", conclusion: "FAILURE", completedAt: "2026-10-24T00:00:00Z" }, { name: "verify", status: "COMPLETED", conclusion: "SUCCESS", completedAt: "2026-10-24T01:00:00Z" }]), "green");
  assert.equal(ciState([{ name: "verify", status: "COMPLETED", conclusion: "FAILURE" }]), "red");
  assert.equal(ciState([{ name: "verify", status: "IN_PROGRESS", conclusion: "" }]), "pending");
  assert.equal(ciState([]), "none");
  assert.equal(ciState([{ name: "Workers Builds: conduit", conclusion: "FAILURE" }]), "none");
});

test("classifyPr flags Bolt/Jules, stale conflicts, docs-only conflicts, stale changes-requested", () => {
  assert.deepEqual(classifyPr(pr({ title: "⚡ Bolt: faster", headRefName: "bolt/x" }), NOW).reasons, ["bolt_jules_micro_opt"]);
  const stale = classifyPr(pr({ mergeable: "CONFLICTING", updatedAt: "2026-10-10T00:00:00Z" }), NOW);
  assert.deepEqual(stale.reasons, ["conflicting_idle_15d"]);
  const docs = classifyPr(pr({ mergeable: "CONFLICTING", files: [{ path: "docs/AUDIT.md" }] }), NOW);
  assert.ok(docs.reasons.includes("docs_only_conflicting"));
  assert.ok(classifyPr(pr({ reviewDecision: "CHANGES_REQUESTED", updatedAt: "2026-10-17T00:00:00Z" }), NOW).reasons[0].startsWith("changes_requested_idle_"));
  const fresh = classifyPr(pr({ mergeable: "CONFLICTING", updatedAt: "2026-10-25T10:00:00Z" }), NOW);
  assert.equal(fresh.closeCandidate, false, "fresh conflicts are active work, not noise");
  assert.equal(classifyPr(pr({ reviewDecision: "CHANGES_REQUESTED", isDraft: true, updatedAt: "2026-10-01T00:00:00Z" }), NOW).closeCandidate, false);
});

test("summarizeRepo counts and target; null input stays null (fail-closed)", () => {
  const s = summarizeRepo([pr({ number: 1 }), pr({ number: 2, title: "Bolt: x" }), pr({ number: 3, baseRefName: "feat/x", files: [{ path: "docs/x.md" }] })], { now: NOW, target: 2 });
  assert.equal(s.open, 3); assert.equal(s.overTarget, 1); assert.equal(s.stacked, 1); assert.equal(s.docsOnly, 1);
  assert.deepEqual(s.closeCandidates.map((c) => c.number), [2]);
  assert.equal(summarizeRepo(null), null);
});

test("markdown renders unavailable repos and sanitizes names", () => {
  const md = hygieneMarkdown({ "Con|duit": null, Resonance: summarizeRepo([pr({ title: "jules: tweak" })], { now: NOW }) });
  assert.match(md, /\| Conduit \| unavailable/);
  assert.match(md, /\| Resonance \| 1 \| 0 \|.*#1 \|/);
});

test("fetchOpenPrs is read-only and fail-closed", () => {
  let argv;
  const ok = fetchOpenPrs("Conduit", { exec: (cmd, a) => { argv = [cmd, ...a]; return "[]"; } });
  assert.deepEqual(ok, []);
  assert.deepEqual(argv.slice(0, 3), ["gh", "pr", "list"]);
  assert.equal(argv[2], "list"); // the only gh subcommand used
  assert.ok(!argv.slice(1, 3).some((x) => /^(close|merge|edit|delete)$/.test(x)));
  assert.equal(fetchOpenPrs("Conduit", { exec: () => { throw new Error("no auth"); } }), null);
  assert.equal(fetchOpenPrs("Conduit", { exec: () => "{\"x\":1}" }), null);
});

test("review fixes: rerun ordering by start time, ERROR status is red, truncated file lists are not docs-only", () => {
  // older completed success + newer in-progress rerun with gh zero-time completedAt => pending, not green
  assert.equal(ciState([
    { name: "verify", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-10-24T00:00:00Z", completedAt: "2026-10-24T00:05:00Z" },
    { name: "verify", status: "IN_PROGRESS", conclusion: "", startedAt: "2026-10-24T01:00:00Z", completedAt: "0001-01-01T00:00:00Z" },
  ]), "pending");
  // legacy StatusContext with state ERROR
  assert.equal(ciState([{ __typename: "StatusContext", context: "ci/legacy", state: "ERROR" }]), "red");
  // 150 changed files but only 100 docs files returned => not docs-only
  const hundred = Array.from({ length: 100 }, (_, i) => ({ path: `docs/f${i}.md` }));
  assert.equal(isDocsOnly(hundred, 150), false);
  assert.equal(isDocsOnly(hundred, 100), true);
});

test("check runs and commit statuses with the same name are separate gates", () => {
  assert.equal(ciState([
    { __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-10-24T02:00:00Z" },
    { __typename: "StatusContext", context: "ci", state: "FAILURE", startedAt: "2026-10-24T01:00:00Z" },
  ]), "red");
});

test("fetchOpenPrs passes a large maxBuffer", () => {
  let opts; fetchOpenPrs("Conduit", { exec: (_c, _a, o) => { opts = o; return "[]"; } });
  assert.ok(opts.maxBuffer >= 16 * 1024 * 1024);
});
