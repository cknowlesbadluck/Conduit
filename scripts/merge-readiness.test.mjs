import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, fetchPr, envVarMentioned } from "./merge-readiness.mjs";

const ok = () => ({ number: 400, isDraft: false, baseRefName: "main", mergeable: "MERGEABLE", behindBy: 0, unresolvedThreads: 0, body: "No env vars.",
  files: ["scripts/x.mjs"], reviews: [{ author: "coderabbitai", state: "COMMENTED" }],
  checks: [{ name: "verify", conclusion: "SUCCESS" }, { name: "Workers Builds: conduit", conclusion: "FAILURE" }] });

test("green PR is ready; Workers Builds ignored", () => assert.deepEqual(evaluate(ok()), { ready: true, blockers: [] }));

test("each criterion blocks", () => {
  const b = (patch) => evaluate({ ...ok(), ...patch }).blockers;
  assert.deepEqual(b({ number: 243 }), ["never_merge_list"]);
  assert.deepEqual(b({ behindBy: 2 }), ["behind_2"]);
  assert.deepEqual(b({ behindBy: undefined }), ["behind_unknown"]);
  assert.deepEqual(b({ mergeable: "CONFLICTING" }), ["mergeable_conflicting"]);
  assert.deepEqual(b({ unresolvedThreads: 3 }), ["unresolved_threads_3"]);
  assert.deepEqual(b({ checks: [{ name: "verify", conclusion: "" }] }), ["check_pending:verify"]);
  assert.deepEqual(b({ checks: [{ name: "Workers Builds: conduit", conclusion: "SUCCESS" }] }), ["no_checks"]);
  assert.deepEqual(b({ files: ["src/auth/oauth.ts"] }), ["sensitive_path:src/auth/oauth.ts"]);
  assert.deepEqual(b({ files: ["migrations/001.sql"] }), ["sensitive_path:migrations/001.sql"]);
  assert.deepEqual(b({ files: [] }), ["files_unknown"]);
  assert.deepEqual(b({ body: "Set FOO_TOKEN=1 on Render" }), ["mentions_env_vars"]);
  assert.deepEqual(b({ isDraft: true }), ["draft"]);
  assert.deepEqual(b({ baseRefName: "feat/x" }), ["base_not_main:feat/x"]);
});

test("latest review per author wins; standing bot CHANGES_REQUESTED blocks", () => {
  assert.deepEqual(evaluate({ ...ok(), reviews: [{ author: "coderabbitai", state: "CHANGES_REQUESTED" }, { author: "coderabbitai", state: "COMMENTED" }] }).blockers, ["changes_requested:coderabbitai"]);
  assert.deepEqual(evaluate({ ...ok(), reviews: [{ author: "coderabbitai", state: "CHANGES_REQUESTED" }, { author: "coderabbitai", state: "APPROVED" }] }).blockers, []);
});

test("invalid input and fetch failure are fail-closed", () => {
  assert.equal(evaluate(null).ready, false);
  assert.equal(fetchPr("o/r", 1, () => { throw new Error("x"); }), null);
});

test("fetchPr maps gh output (read-only commands only)", () => {
  const calls = [];
  const run = (a) => { calls.push(a);
    if (a[0] === "pr") return JSON.stringify({ number: 5, isDraft: false, mergeable: "MERGEABLE", headRefName: "h", body: "", files: [{ path: "a.md" }], reviews: [{ author: { login: "x" }, state: "APPROVED" }], statusCheckRollup: [{ name: "verify", conclusion: "SUCCESS" }] });
    if (a[1] === "--paginate") return "a.md\n";
    if (a[1].startsWith("repos/")) return JSON.stringify({ b: 0 });
    const second = a.includes("c=CUR");
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: second
      ? { nodes: [{ isResolved: false }], pageInfo: { hasNextPage: false } }
      : { nodes: [{ isResolved: false }, { isResolved: true }], pageInfo: { hasNextPage: true, endCursor: "CUR" } } } } } }); };
  const pr = fetchPr("o/r", 5, run);
  assert.equal(pr.unresolvedThreads, 2); // paginated
  assert.equal(pr.behindBy, 0);
  assert.deepEqual(pr.files, ["a.md"]);
  assert.ok(calls.every((a) => (a[0] === "pr" && a[1] === "view") || (a[0] === "api" && !a.includes("-X"))));
});

test("review fixes: env-var lines, DB TLS files, incomplete file lists, head SHA compare", () => {
  assert.equal(envVarMentioned("No env vars.\nSet FOO_TOKEN=1 on Render"), true);
  assert.equal(envVarMentioned("No env vars. No auth changes."), false);
  assert.equal(envVarMentioned("Adds a new env var for timeouts"), true);
  assert.deepEqual(evaluate({ ...ok(), files: ["src/store.ts"] }).blockers, ["sensitive_path:src/store.ts"]);
  assert.deepEqual(evaluate({ ...ok(), changedFiles: 150, files: Array.from({ length: 100 }, (_, i) => `d/${i}.md`) }).blockers, ["files_incomplete"]);
  const calls = [];
  fetchPr("o/r", 5, (a) => { calls.push(a.join(" "));
    if (a[0] === "pr") return JSON.stringify({ number: 5, headRefName: "same-name", headRefOid: "abc123", files: [], reviews: [], statusCheckRollup: [] });
    if (a[1] === "--paginate") return "a.md\n";
    if (a[1].startsWith("repos/")) return JSON.stringify({ b: 0 });
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } }); });
  assert.ok(calls.some((c) => c.includes("compare/main...abc123")));
});

test("second review round: short env assignment, auth wiring, renames, error diagnostics", () => {
  assert.equal(envVarMentioned("DB=prod"), true);
  assert.deepEqual(evaluate({ ...ok(), files: ["src/index.ts"] }).blockers, ["sensitive_path:src/index.ts"]);
  const pr = fetchPr("o/r", 5, (a) => {
    if (a[0] === "pr") return JSON.stringify({ number: 5, headRefOid: "h", reviews: [], statusCheckRollup: [] });
    if (a[1] === "--paginate") return "docs/x.md\nsrc/store.ts\n"; // rename src/store.ts -> docs/x.md
    if (a[1].startsWith("repos/")) return JSON.stringify({ b: 0 });
    return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } }); });
  assert.ok(evaluate({ ...ok(), files: pr.files }).blockers.includes("sensitive_path:src/store.ts"));
  assert.equal(fetchPr("o/r", 1, () => { const e = new Error("x"); e.stderr = "HTTP 404: Not Found\nmore"; throw e; }), null);
  assert.equal(fetchPr.lastError, "HTTP 404: Not Found");
});
