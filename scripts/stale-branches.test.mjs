import test from "node:test";
import assert from "node:assert/strict";
import { staleBranches, fetchStaleBranches, markSafeDelete, aheadBy } from "./stale-branches.mjs";

const now = Date.parse("2026-10-23T22:00:00Z");
test("staleBranches: 14+ days, no open PR, not default branch", () => {
  const b = [
    { name: "main", committedAt: "2026-01-01T00:00:00Z" },
    { name: "old-no-pr", committedAt: "2026-09-01T00:00:00Z" },
    { name: "old-with-pr", committedAt: "2026-09-01T00:00:00Z" },
    { name: "fresh", committedAt: "2026-10-20T00:00:00Z" },
    { name: "edge14", committedAt: "2026-10-09T22:00:00Z" },
    { name: "bad-date", committedAt: undefined },
  ];
  const r = staleBranches(b, ["old-with-pr"], { now });
  assert.deepEqual(r.map((x) => x.name), ["old-no-pr", "edge14"]);
  assert.equal(r[1].ageDays, 14);
});

test("fetchStaleBranches: null without token, null on GraphQL errors, read-only POST to graphql", async () => {
  assert.deepEqual(await fetchStaleBranches({ repos: ["A"], token: "" }), { A: null });
  const calls = [];
  const ok = async (url, init) => { calls.push(url); return { ok: true, json: async () => ({ data: { repository: { defaultBranchRef: { name: "main" }, pullRequests: { totalCount: 2, nodes: [{ headRefName: "b2" }, { headRefName: "b1", isCrossRepository: true }] }, refs: { pageInfo: { hasNextPage: false }, nodes: [{ name: "b1", target: { committedDate: "2026-09-01T00:00:00Z" } }, { name: "b2", target: { committedDate: "2026-09-01T00:00:00Z" } }] } } } }) }; };
  const r = await fetchStaleBranches({ repos: ["A"], token: "t", fetchImpl: ok, now });
  assert.deepEqual(r.A.map((x) => x.name), ["b1"]);
  assert.deepEqual(calls, ["https://api.github.com/graphql"]);
  const err = async () => ({ ok: true, json: async () => ({ errors: [{ message: "x" }] }) });
  assert.deepEqual(await fetchStaleBranches({ repos: ["A"], token: "t", fetchImpl: err, now }), { A: null });
});

test("fetchStaleBranches: branch heading an open PR into another repo is not stale", async () => {
  const now = Date.parse("2026-10-23T00:00:00Z");
  const old = "2026-01-01T00:00:00Z";
  const body = { data: { repository: { defaultBranchRef: { name: "main" }, pullRequests: { totalCount: 0, nodes: [] },
    refs: { pageInfo: { hasNextPage: false }, nodes: [
      { name: "upstream-fix", associatedPullRequests: { totalCount: 1 }, target: { committedDate: old } },
      { name: "dead", associatedPullRequests: { totalCount: 0 }, target: { committedDate: old } }] } } } };
  const fetchImpl = async () => ({ ok: true, json: async () => body });
  const r = await fetchStaleBranches({ repos: ["A"], token: "t", fetchImpl, now });
  assert.deepEqual(r.A.map((b) => b.name), ["dead"]);
});

test("staleBranches: flags young branches whose last PR is merged/closed; open PR still protects", () => {
  const now = Date.parse("2026-10-23T00:00:00Z");
  const young = "2026-10-20T00:00:00Z";
  const b = [
    { name: "merged", committedAt: young, lastPr: { number: 7, state: "MERGED" } },
    { name: "closed", committedAt: young, lastPr: { number: 8, state: "CLOSED" } },
    { name: "reopened", committedAt: young, lastPr: { number: 9, state: "CLOSED" } },
    { name: "young-none", committedAt: young, lastPr: null },
    { name: "weird", committedAt: young, lastPr: { number: "x", state: "MERGED" } },
  ];
  const r = staleBranches(b, ["reopened"], { now });
  assert.deepEqual(r.map((x) => [x.name, x.reason, x.pr?.number]), [["closed", "pr_closed", 8], ["merged", "pr_merged", 7]]);
});

test("fetchStaleBranches: reads lastPr alias (report only)", async () => {
  const now = Date.parse("2026-10-23T00:00:00Z");
  const body = { data: { repository: { defaultBranchRef: { name: "main" }, pullRequests: { totalCount: 0, nodes: [] },
    refs: { pageInfo: { hasNextPage: false }, nodes: [
      { name: "done", associatedPullRequests: { totalCount: 0 }, lastPr: { nodes: [{ number: 3, state: "MERGED" }] }, target: { committedDate: "2026-10-22T00:00:00Z" } }] } } } };
  let sent;
  const r = await fetchStaleBranches({ repos: ["A"], token: "t", fetchImpl: async (u, i) => { if (u.endsWith("/graphql")) { sent = i; return { ok: true, json: async () => body }; } return { ok: true, json: async () => ({ ahead_by: 0 }) }; }, now });
  assert.deepEqual(r.A, [{ name: "done", committedAt: "2026-10-22T00:00:00Z", ageDays: 1, reason: "pr_merged", pr: { number: 3, state: "MERGED" }, aheadBy: 0, safeDelete: true }]);
  assert.equal(sent.method, "POST"); assert.match(JSON.parse(sent.body).query, /^query/);
});

test("markSafeDelete: only merged/closed PR with aheadBy 0 is safe; unknown is not", () => {
  const e = [{ name: "a", pr: { number: 1, state: "MERGED" } }, { name: "b", pr: { number: 2, state: "CLOSED" } }, { name: "c", pr: { number: 3, state: "MERGED" } }, { name: "d" }];
  const r = markSafeDelete(e, { a: 0, b: 2, d: 0 });
  assert.deepEqual(r.map((x) => [x.name, x.aheadBy, x.safeDelete]), [["a", 0, true], ["b", 2, false], ["c", null, false], ["d", 0, false]]);
});

test("aheadBy: encodes refs, returns ahead_by, null on http error/bad body/throw", async () => {
  let u;
  assert.equal(await aheadBy({ owner: "o", repo: "r", base: "main", head: "feat/x#1", token: "t", fetchImpl: async (url) => { u = url; return { ok: true, json: async () => ({ ahead_by: 0 }) }; } }), 0);
  assert.equal(u, "https://api.github.com/repos/o/r/compare/main...feat%2Fx%231");
  assert.equal(await aheadBy({ owner: "o", repo: "r", base: "main", head: "x", token: "t", fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await aheadBy({ owner: "o", repo: "r", base: "main", head: "x", token: "t", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), null);
  assert.equal(await aheadBy({ owner: "o", repo: "r", base: "main", head: "x", token: "t", fetchImpl: async () => { throw new Error("n"); } }), null);
});
