import test from "node:test";
import assert from "node:assert/strict";
import { decideHygiene, persistenceBlocked } from "./hygiene-prune.js";

const live = {
  projects: [
    { name: "Resonance", status: "INACTIVE" as const },
    { name: "Quicksilver: Mercurial intelligence", status: "INACTIVE" as const },
    { name: "WhereamI?", status: "INACTIVE" as const },
  ],
  branches: [
    { repo: "Conduit", name: "release/0.8.0", diverged: true },
    { repo: "Quicksilver", name: "main", archivedRepo: true },
  ],
  pulls: [
    { repo: "Conduit", number: 187, title: "feat: portfolio cutover lattice" },
    { repo: "Conduit", number: 119, title: "DRAFT KEEP RED: Add managed SSE admission and graceful shutdown" },
    { repo: "Conduit", number: 120, title: "DRAFT KEEP RED: Add explicit ordered database migrations" },
    { repo: "Conduit", number: 155, title: "DB TLS: verify Postgres certificates by default (DO NOT MERGE until Render env is set)" },
    { repo: "Conduit", number: 162, title: "harden: shared Postgres TLS policy and optional HMAC cursors" },
    { repo: "Resonance", number: 154, title: "feat: portfolio cutover lattice" },
    { repo: "QuicksilverV1", number: 242, title: "feat: portfolio cutover lattice" },
    { repo: "QuicksilverV1", number: 209, title: "chore(deps): bump actions/checkout from 4 to 7 in the actions group" },
  ],
  latticeFamilyOpen: true,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  legacyArchived: true,
  mcpArchived: true,
};

test("inactive Supabase blocks persistence proof", () => {
  assert.equal(persistenceBlocked(live.projects), true);
});

test("live portfolio prune deletes nothing and opens nothing", () => {
  const decision = decideHygiene(live);
  assert.equal(decision.revision, "2026-10-09-hygiene-prune");
  assert.equal(decision.openNewWitness, false);
  assert.deepEqual(decision.deleteBranches, []);
  assert.deepEqual(decision.closePulls, []);
  assert.deepEqual(decision.mergePulls, []);
  assert.equal(decision.persistenceProof, false);
  assert.equal(decision.singleLegalAction, "owner_unpause_then_set_key");
  assert.equal(decision.dispositions.some((row) => row.target === "Conduit#release/0.8.0" && row.disposition === "hold_not_delete"), true);
  assert.equal(decision.dispositions.filter((row) => row.disposition === "keep_unmerged").length, 4);
  assert.equal(decision.dispositions.some((row) => row.target === "QuicksilverV1#209" && row.disposition === "hold_until_ci"), true);
  assert.equal(decision.dispositions.some((row) => row.target === "cknowlesbadluck/mcp" && row.disposition === "already_pruned"), true);
});

test("a closed lattice family is not a reason to open a new witness", () => {
  assert.throws(() => decideHygiene({ ...live, latticeFamilyOpen: false }), /new witness family/);
});

test("an active-only project list cannot be classified as this pass", () => {
  assert.throws(() => decideHygiene({
    ...live,
    projects: [{ name: "Resonance", status: "ACTIVE" }],
  }), /inactive project/);
});
