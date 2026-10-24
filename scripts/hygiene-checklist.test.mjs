import test from "node:test";
import assert from "node:assert/strict";
import { isDocsOnly, mainCiStatus, hygieneChecklist, fetchHygiene } from "./hygiene-checklist.mjs";

test("isDocsOnly", () => {
  assert.equal(isDocsOnly(["docs/a.md", "README.md", "docs/img.png"]), true);
  assert.equal(isDocsOnly(["docs/a.md", "src/x.ts"]), false);
  assert.equal(isDocsOnly([]), false);
  assert.equal(isDocsOnly(null), false);
  assert.equal(isDocsOnly([null]), false);
});

test("mainCiStatus uses newest run per workflow and ignores listed workflows", () => {
  const runs = [
    { name: "CI", status: "completed", conclusion: "failure", created_at: "2026-10-23T00:00:00Z" },
    { name: "CI", status: "completed", conclusion: "success", created_at: "2026-10-24T00:00:00Z" },
    { name: "Workers Builds: conduit", status: "completed", conclusion: "failure", created_at: "2026-10-24T00:00:00Z" },
  ];
  assert.deepEqual(mainCiStatus(runs, { ignore: ["Workers Builds: conduit"] }), { status: "green", failing: [] });
  assert.deepEqual(mainCiStatus(runs), { status: "red", failing: ["Workers Builds: conduit"] });
  assert.equal(mainCiStatus([{ name: "CI", status: "in_progress", created_at: "2026-10-24T00:00:00Z" }]).status, "pending");
  assert.equal(mainCiStatus([]).status, "unknown");
  assert.equal(mainCiStatus(undefined), null);
});

test("hygieneChecklist renders boxes and fails closed", () => {
  const md = hygieneChecklist({
    Conduit: { openPrs: 26, ci: { status: "green", failing: [] }, docsOnlyPrs: 0, staleBranches: 3, safeDelete: 1, dependabot: 0 },
    "Res<x>": null,
  }, { at: "T" });
  assert.match(md, /\[ \] Open PRs below 10: 26/);
  assert.match(md, /\[x\] Main CI green: green/);
  assert.match(md, /\[x\] Docs-only PRs at most 1 .*: 0/);
  assert.match(md, /\[ \] No stale branches: 3 stale, 1 safe-delete/);
  assert.match(md, /\[x\] No open Dependabot alerts: 0/);
  assert.match(md, /## Resx\n- \[\?\] Open PRs below 10: unavailable/);
  assert.doesNotMatch(md, /</);
});

test("fetchHygiene is GET-only, skips token-only calls without a token, never throws", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/pulls?")) return { ok: true, json: async () => [{ number: 1 }] };
    if (url.endsWith("/actions/workflows?per_page=100")) return { ok: true, json: async () => ({ workflows: [{ id: 7, state: "active" }, { id: 8, state: "disabled_manually" }] }) };
    if (url.includes("/workflows/7/runs")) return { ok: true, json: async () => ({ workflow_runs: [{ workflow_id: 7, name: "CI", status: "completed", conclusion: "success", created_at: "2026-10-24T00:00:00Z" }] }) };
    return { ok: false, status: 404 };
  };
  const r = await fetchHygiene({ repos: ["Conduit"], token: null, fetchImpl });
  assert.equal(r.Conduit.openPrs, 1);
  assert.equal(r.Conduit.ci.status, "green");
  assert.equal(r.Conduit.docsOnlyPrs, null);
  assert.equal(r.Conduit.dependabot, null);
  assert.ok(calls.every((c) => !c.init.method && !c.init.headers.authorization));
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((c) => c.url.includes("/workflows/8/")));

  const boom = await fetchHygiene({ repos: ["X"], token: "t", fetchImpl: async () => { throw new Error("net"); } });
  assert.deepEqual(boom.X, { openPrs: null, docsOnlyPrs: null, ci: null, dependabot: null, staleBranches: null, safeDelete: null });
});

test("fetchHygiene counts docs-only PRs and Dependabot alerts with a token", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/pulls?")) return { ok: true, json: async () => [{ number: 1 }, { number: 2 }] };
    if (url.includes("/pulls/1/files")) return { ok: true, json: async () => [{ filename: "docs/A.md" }] };
    if (url.includes("/pulls/2/files")) return { ok: true, json: async () => [{ filename: "src/a.ts" }] };
    if (url.includes("/dependabot/")) return { ok: true, json: async () => [{}, {}] };
    return { ok: false, status: 500 };
  };
  const r = await fetchHygiene({ repos: ["R"], token: "t", fetchImpl, stale: { R: [{ safeDelete: true }, { safeDelete: false }] } });
  assert.equal(r.R.docsOnlyPrs, 1);
  assert.equal(r.R.dependabot, 2);
  assert.equal(r.R.ci, null);
  assert.equal(r.R.staleBranches, 2);
  assert.equal(r.R.safeDelete, 1);
});

test("fetchHygiene: capped file list -> docs-only unavailable; Dependabot fetched even when PR list fails", async () => {
  const capped = await fetchHygiene({ repos: ["R"], token: "t", fetchImpl: async (url) => {
    if (url.includes("/pulls?")) return { ok: true, json: async () => [{ number: 1 }] };
    if (url.includes("/files")) return { ok: true, json: async () => Array.from({ length: 100 }, () => ({ filename: "docs/a.md" })) };
    return { ok: false, status: 500 };
  } });
  assert.equal(capped.R.docsOnlyPrs, null);
  const noPrs = await fetchHygiene({ repos: ["R"], token: "t", fetchImpl: async (url) => {
    if (url.includes("/dependabot/")) return { ok: true, json: async () => [{}] };
    return { ok: false, status: 500 };
  } });
  assert.equal(noPrs.R.openPrs, null);
  assert.equal(noPrs.R.dependabot, 1);
});

test("mainCiStatus groups by workflow_id, not display name", () => {
  const runs = [
    { workflow_id: 1, name: "CI", status: "completed", conclusion: "failure", created_at: "2026-10-23T00:00:00Z" },
    { workflow_id: 2, name: "CI", status: "completed", conclusion: "success", created_at: "2026-10-24T00:00:00Z" },
  ];
  assert.equal(mainCiStatus(runs).status, "red");
});
