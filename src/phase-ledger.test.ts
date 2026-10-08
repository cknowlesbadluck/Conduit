import test from "node:test";
import assert from "node:assert/strict";
import { bindingPhase, evaluatePhases, planPrune } from "./phase-ledger.js";

const live = {
  conduitReady: true,
  resonanceStatus: 503,
  resonanceMissing: ["SUPABASE_SERVICE_ROLE_KEY"],
  resonanceLeaksContract: false,
  vercelAliasAbsent: true,
  witnessBudgetSpent: true,
  hardwareRunRecorded: false,
  legacyArchiveStatus: 403,
};

test("2026-10-08 ledger blocks on the owner gate and does not treat the alias as the constraint", () => {
  const phases = evaluatePhases(live);
  assert.equal(phases.length, 10);
  assert.equal(phases[0].state, "owner_blocked");
  assert.equal(phases[2].state, "met");
  assert.equal(phases[4].state, "owner_blocked");
  assert.equal(phases[8].state, "refused");
  assert.equal(bindingPhase(phases), 1);
});

test("prune plan deletes merged and orphan fences, closes bolt, refuses keep-red", () => {
  const actions = planPrune(
    [
      { name: "main", hasOpenPull: false, shaEqualsDefault: true },
      { name: "release/0.8.0", hasOpenPull: false, shaEqualsDefault: false },
      { name: "harden/prune-ledger-0600", hasOpenPull: false, shaEqualsDefault: true },
      { name: "hygiene/owner-gate-fence-2026-10-08", hasOpenPull: false, shaEqualsDefault: false },
      { name: "harden/entropy-governor-2300", hasOpenPull: true, shaEqualsDefault: false },
    ],
    [
      { number: 186, title: "Bolt: Fast-path key length", draft: false },
      { number: 155, title: "DB TLS", draft: false },
      { number: 119, title: "DRAFT KEEP RED: SSE", draft: true },
    ],
  );
  assert.deepEqual(
    actions.filter((action) => action.kind === "delete_branch"),
    [
      { kind: "delete_branch", name: "harden/prune-ledger-0600", reason: "merged_equivalent" },
      { kind: "delete_branch", name: "hygiene/owner-gate-fence-2026-10-08", reason: "orphan_fence" },
    ],
  );
  assert.equal(actions.some((action) => action.kind === "close_pull" && action.number === 186), true);
  assert.equal(actions.some((action) => action.kind === "refuse_merge" && action.number === 155), true);
  assert.equal(actions.some((action) => action.kind === "delete_branch" && action.name === "release/0.8.0"), false);
});
