import test from "node:test";
import assert from "node:assert/strict";
import { staleBranches, fetchStaleBranches } from "./stale-branches.mjs";

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
