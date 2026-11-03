import test from "node:test";
import assert from "node:assert/strict";
import { OWNER_ONLY_PATHS, isOwnerOnlyPath, ownerOnlyPaths } from "./owner-only-paths.mjs";

test("owner-only surfaces from both former lists are gated", () => {
  for (const p of ["src/auth.ts", "src/auth.verifier.test.ts", "src/index.ts", "src/app-factory.ts", "src/grant-tools.ts", "src/capabilities.ts",
    "src/tool-gates.test.ts", "src/mcp-bridge.ts", "src/external-policy.ts", "src/receipts/chain.ts", "migrations/001.sql", "src/secret-store.ts",
    ".env.example", "src/db-tls.ts", "src/store.ts", "src/db-ready.ts", "src/binding-subjects.ts", "src/capability-store.ts", "src/trust-proxy.ts",
    "render.yaml", ".github/workflows/ci.yml"]) assert.equal(isOwnerOnlyPath(p), true, p);
});

test("ordinary paths are not gated", () => {
  for (const p of ["scripts/dep-audit.mjs", "docs/ROADMAP.md", "src/pagination.ts", "src/redact.ts", "package.json", "src/storefront.md"]) assert.equal(isOwnerOnlyPath(p), false, p);
});

test("fails closed on missing paths; accepts gh file shapes; list is frozen", () => {
  assert.equal(isOwnerOnlyPath(undefined), true);
  assert.equal(isOwnerOnlyPath(""), true);
  assert.deepEqual(ownerOnlyPaths(["a.md", { filename: "src/auth.ts" }, { path: "src/grant-tools.ts" }, { filename: "b.md" }]), ["src/auth.ts", "src/grant-tools.ts"]);
  assert.ok(Object.isFrozen(OWNER_ONLY_PATHS));
});

test("tests of exact-match owner-only sources are owner-only too (review)", () => {
  for (const f of ["src/index.test.ts", "src/app-factory.test.ts", "src/store.test.ts", "src/db-ready.test.ts", "src/binding-subjects.test.ts"]) assert.equal(isOwnerOnlyPath(f), true, f);
  assert.equal(isOwnerOnlyPath("src/storefront.ts"), false);
});

test("variant test files of exact-match owner-only sources are owner-only (review)", () => {
  for (const f of ["src/store.coverage.test.ts", "src/store.pagination.postgres.test.ts", "src/db-ready-timeout.test.ts", "src/index.boot.test.ts", "src/app-factory-mcp.test.ts"]) assert.equal(isOwnerOnlyPath(f), true, f);
  for (const f of ["src/storefront.ts", "src/store-helpers.ts", "src/indexer.ts"]) assert.equal(isOwnerOnlyPath(f), false, f);
});
