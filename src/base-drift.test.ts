import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBaseDrift, assertStampDoesNotClearOwner, assertHoldNotDeleted, NOT_MERGE } from "./base-drift.js";

const probe = {
  resonanceReady: 503,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  readyOmitsOwnerFields: true,
  supabaseInactive: ["Resonance", "Quicksilver", "WhereamI"],
  vercelClass: "alias_absent" as const,
  deviceGateRecorded: false,
  secretInvented: false as const,
};

test("15:00 EDT base drift stays on phase 0", () => {
  const decision = evaluateBaseDrift(probe);
  assert.equal(decision.revision, "2026-10-09-base-drift");
  assert.equal(decision.currentPhase, 0);
  assert.equal(decision.stampIsNotAdvance, true);
  assert.equal(decision.pullMerged, false);
  assert.equal(decision.stabilization, "branch_contains_main");
  assert.equal(decision.driftBefore.length, 3);
  assert.deepEqual(decision.pruneThisPass, []);
  assert.ok(decision.notMerged.includes(187));
  assert.equal(decision.secretInvented, false);
});

test("a stamp cannot clear the owner gate", () => {
  assert.throws(() => assertStampDoesNotClearOwner(0, 1), /owner gate/);
  assertStampDoesNotClearOwner(0, 0);
});

test("hold and pruned fence names are not deleted", () => {
  assert.throws(() => assertHoldNotDeleted("release/0.8.0"), /refusing to prune/);
  assert.throws(() => assertHoldNotDeleted("feat/pause-before-secret"), /refusing to prune/);
  assert.equal(NOT_MERGE.includes(209), true);
});
