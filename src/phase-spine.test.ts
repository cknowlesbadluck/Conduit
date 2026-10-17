import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSpine, PRUNED_FENCE_BRANCHES } from "./phase-spine.js";

const probe = {
  resonanceReady: 503,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  readyOmitsOwnerFields: true,
  supabaseInactive: ["Resonance", "Quicksilver", "WhereamI"],
  vercelClass: "alias_absent" as const,
  deviceGateRecorded: false,
  persistenceProven: false,
};

test("13:00 EDT spine stays on phase 0 and records the executed fence prune", () => {
  const decision = evaluateSpine(probe);
  assert.equal(decision.revision, "2026-10-09-phase-spine");
  assert.equal(decision.currentPhase, 0);
  assert.equal(decision.phases[1].state, "satisfied");
  assert.equal(decision.phases[2].state, "satisfied");
  assert.equal(decision.secretInvented, false);
  assert.deepEqual(decision.pruneExecuted, [...PRUNED_FENCE_BRANCHES]);
  assert.ok(decision.holdNotDelete.includes("release/0.8.0"));
});

test("reopening a pruned fence branch is a regression", () => {
  const decision = evaluateSpine(probe, "feat/pause-before-secret");
  assert.equal(decision.reopenRefusal, "refusing to reopen pruned fence branch feat/pause-before-secret");
});

test("a ready body that drops the owner key without 200 is refused", () => {
  assert.throws(
    () => evaluateSpine({ ...probe, missingRequired: [], resonanceReady: 503 }),
    /dropped the owner key/,
  );
});
