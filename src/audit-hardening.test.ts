import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAudit, assertStampDoesNotClearOwner, HOLD_NOT_DELETE } from "./audit-hardening.js";

const probe = {
  resonanceReady: 503,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  readyOmitsOwnerFields: true,
  supabaseInactive: ["Resonance", "Quicksilver", "WhereamI"],
  vercelClass: "alias_absent" as const,
  deviceGateRecorded: false,
  persistenceProven: false,
};

const liveRefs = [
  { repo: "Conduit", name: "main", openPull: null },
  { repo: "Conduit", name: "release/0.8.0", openPull: null },
  { repo: "Conduit", name: "feat/cutover-lattice-1000", openPull: 187 },
  { repo: "Conduit", name: "feat/admission-clock", openPull: 190 },
  { repo: "Conduit", name: "codex/add-event-stream-manager-module", openPull: 119 },
  { repo: "Conduit", name: "codex/refactor-schema-ddl-into-migration-modules", openPull: 120 },
  { repo: "Conduit", name: "counsel/db-tls-verify", openPull: 155 },
  { repo: "Conduit", name: "harden/ssl-and-signed-cursors", openPull: 162 },
  { repo: "Conduit", name: "bolt-optimize-cursor-validation-task-filter-construction-11315320121705202538", openPull: 188 },
  { repo: "Resonance", name: "main", openPull: null },
  { repo: "Resonance", name: "feat/cutover-lattice-1000", openPull: 154 },
  { repo: "Resonance", name: "feat/chamber-dissolve-guard", openPull: 157 },
  { repo: "QuicksilverV1", name: "main", openPull: null },
  { repo: "QuicksilverV1", name: "feat/cutover-lattice-1000", openPull: 242 },
  { repo: "QuicksilverV1", name: "dependabot/github_actions/actions-640176b5ab", openPull: 209 },
];

test("14:00 EDT audit stays on phase 0 and prunes nothing", () => {
  const decision = evaluateAudit(probe, liveRefs);
  assert.equal(decision.revision, "2026-10-09-audit-hardening");
  assert.equal(decision.currentPhase, 0);
  assert.equal(decision.stampIsNotAdvance, true);
  assert.equal(decision.entropySatisfied, true);
  assert.deepEqual(decision.pruneThisPass, []);
  assert.equal(decision.secretInvented, false);
  assert.equal(decision.discretionaryByRepo.Conduit, 2);
  assert.equal(decision.discretionaryByRepo.Resonance, 2);
  assert.equal(decision.discretionaryByRepo.QuicksilverV1, 1);
  assert.ok(decision.holdNotDelete.includes("release/0.8.0"));
  assert.ok(decision.notMerged.includes(187));
});

test("an orphan ref is the only prune target", () => {
  const decision = evaluateAudit(probe, [...liveRefs, { repo: "Conduit", name: "hygiene/orphan-fence", openPull: null }]);
  assert.deepEqual(decision.pruneThisPass, ["Conduit:hygiene/orphan-fence"]);
  assert.equal(decision.entropySatisfied, false);
});

test("reopening a pruned fence is refused and a hold delete throws", () => {
  const decision = evaluateAudit(probe, liveRefs, "feat/pause-before-secret");
  assert.match(decision.reopenRefusal ?? "", /pruned fence/);
  assert.throws(() => evaluateAudit(probe, liveRefs, "release/0.8.0"), /hold ref/);
  assert.throws(() => assertStampDoesNotClearOwner(0, 3), /owner gate/);
  assert.ok(HOLD_NOT_DELETE.includes("feat/chamber-dissolve-guard"));
});
