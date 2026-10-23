import test from "node:test";
import assert from "node:assert/strict";
import { addedEnvVars, classifyDecisions, decisionQueue, fetchDecisionQueue, isBot } from "./decision-queue.mjs";

test("isBot: [bot] suffix and known reviewer bots; humans are not bots", () => {
  assert.equal(isBot("coderabbitai"), true); assert.equal(isBot("dependabot[bot]"), true);
  assert.equal(isBot("cknowlesbadluck"), false); assert.equal(isBot(undefined), false);
});

test("bot_only_approval only when every approval is a bot", () => {
  assert.deepEqual(classifyDecisions({ number: 1, reviews: [{ login: "coderabbitai", state: "APPROVED" }], checkCount: 1 }).categories, ["bot_only_approval"]);
  assert.deepEqual(classifyDecisions({ number: 2, reviews: [{ login: "coderabbitai", state: "APPROVED" }, { login: "alice", state: "APPROVED" }], checkCount: 1 }).categories, []);
  assert.deepEqual(classifyDecisions({ number: 3, reviews: [{ login: "coderabbitai", state: "COMMENTED" }], checkCount: 1 }).categories, []);
});

test("addedEnvVars: new process.env names and .env lines; moved names ignored; plain code CONSTANT= not counted", () => {
  const files = [
    { filename: "src/a.ts", patch: "+const s = process.env.CONDUIT_CURSOR_SECRET;\n-const x = process.env.OLD_ONE;\n+const x = process.env.OLD_ONE ?? 1;\n+MAX_ROWS = 5" },
    { filename: ".env.example", patch: "+NEW_FLAG=1\n" },
  ];
  assert.deepEqual(addedEnvVars(files), ["CONDUIT_CURSOR_SECRET", "NEW_FLAG"]);
  assert.deepEqual(addedEnvVars([{ filename: "x", patch: undefined }]), []);
});

test("auth/grants/migration paths, behind/dirty, changes requested, no CI", () => {
  const r = classifyDecisions({ number: 4, reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "DIRTY", files: [{ filename: "src/grants.ts" }], checkCount: 0 });
  assert.deepEqual(r.categories, ["changes_requested", "auth_grants_paths", "behind_main", "no_ci"]);
  assert.deepEqual(classifyDecisions({ number: 5, files: [{ filename: "supabase/migrations/1.sql" }], checkCount: 2 }).categories, ["auth_grants_paths"]);
  assert.deepEqual(classifyDecisions({ number: 6, files: [{ filename: "src/author-name.ts" }], checkCount: 2 }).categories, []);
});

test("decisionQueue groups by category", () => {
  const q = decisionQueue([{ number: 1, reviewDecision: "CHANGES_REQUESTED", checkCount: 1 }, { number: 2, checkCount: 1 }]);
  assert.equal(q.open, 2); assert.equal(q.blocked, 1); assert.deepEqual(q.byCategory.changes_requested, [1]);
});

test("fetchDecisionQueue: read-only GETs + one graphql POST, token only in header, null on error/truncation", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method ?? "GET", auth: init.headers.Authorization });
    if (url.endsWith("/graphql")) return { ok: true, json: async () => ({ data: { repository: { pullRequests: { totalCount: 1, nodes: [{ number: 9, title: "t", reviewDecision: null, mergeStateStatus: "BEHIND", latestReviews: { totalCount: 0, nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }] } } } }) };
    return { ok: true, json: async () => [{ filename: "README.md", patch: "+x" }] };
  };
  const out = await fetchDecisionQueue({ repos: ["A"], token: "tkn", fetchImpl });
  assert.deepEqual(out.A.byCategory.behind_main, [9]); assert.deepEqual(out.A.byCategory.no_ci, [9]);
  assert.ok(calls.every((c) => c.method === "GET" || c.url.endsWith("/graphql")));
  assert.ok(!JSON.stringify(out).includes("tkn"));
  const trunc = await fetchDecisionQueue({ repos: ["A"], token: "t", fetchImpl: async () => ({ ok: true, json: async () => ({ data: { repository: { pullRequests: { totalCount: 101, nodes: [] } } } }) }) });
  assert.equal(trunc.A, null);
  const err = await fetchDecisionQueue({ repos: ["A"], token: "t", fetchImpl: async () => { throw new Error("x"); } });
  assert.equal(err.A, null);
});

test("env: second reference on a kept line is detected", () => {
  assert.deepEqual(addedEnvVars([{ filename: "src/a.ts", patch: "-const k = process.env.OLD_KEY;\n+const k = process.env.OLD_KEY ?? process.env.NEW_KEY;" }]), ["NEW_KEY"]);
});

test("authentication/authorization paths count; author does not", () => {
  assert.deepEqual(classifyDecisions({ number: 7, files: [{ filename: "src/authentication/login.ts" }], checkCount: 1 }).categories, ["auth_grants_paths"]);
  assert.deepEqual(classifyDecisions({ number: 8, files: [{ filename: "src/authorization/rules.ts" }], checkCount: 1 }).categories, ["auth_grants_paths"]);
});

test("fetchDecisionQueue fails closed: no token, GraphQL errors, truncated reviews", async () => {
  let called = false;
  assert.equal((await fetchDecisionQueue({ repos: ["A"], token: "", fetchImpl: async () => { called = true; } })).A, null);
  assert.equal(called, false);
  const node = (rv) => ({ number: 1, title: "t", latestReviews: rv, commits: { nodes: [] } });
  const gql = (body) => async (url) => url.endsWith("/graphql") ? { ok: true, json: async () => body } : { ok: true, json: async () => [] };
  assert.equal((await fetchDecisionQueue({ repos: ["A"], token: "t", fetchImpl: gql({ errors: [{ message: "x" }], data: { repository: { pullRequests: { totalCount: 1, nodes: [node({ totalCount: 0, nodes: [] })] } } } }) })).A, null);
  assert.equal((await fetchDecisionQueue({ repos: ["A"], token: "t", fetchImpl: gql({ data: { repository: { pullRequests: { totalCount: 1, nodes: [node({ totalCount: 101, nodes: [] })] } } } }) })).A, null);
  assert.equal((await fetchDecisionQueue({ repos: ["A"], token: "t", fetchImpl: gql({ data: { repository: { pullRequests: { totalCount: 1, nodes: [node(null)] } } } }) })).A, null);
});

test("addedEnvVars: only .env.example lines and non-test src/ process.env reads count", () => {
  const files = [
    { filename: "scripts/decision-queue.mjs", patch: "+const t = process.env.GH_TOKEN;" },
    { filename: "scripts/decision-queue.test.mjs", patch: "+const p = '+x = process.env.FIXTURE_ONE';" },
    { filename: "src/foo.test.ts", patch: "+process.env.TEST_ONLY = '1';" },
    { filename: "src/fixtures/env.ts", patch: "+process.env.FIXTURE_TWO;" },
    { filename: ".env.local", patch: "+LOCAL_ONLY=1" },
    { filename: "src/config.ts", patch: "+const k = process.env.REAL_NEW_VAR;" },
    { filename: ".env.example", patch: "+EXAMPLE_VAR=" },
  ];
  assert.deepEqual(addedEnvVars(files), ["EXAMPLE_VAR", "REAL_NEW_VAR"]);
});

test("renamed sensitive file is flagged via previousFilename", () => {
  assert.deepEqual(classifyDecisions({ number: 9, files: [{ filename: "src/identity.ts", previousFilename: "src/auth.ts" }], checkCount: 1 }).categories, ["auth_grants_paths"]);
});
