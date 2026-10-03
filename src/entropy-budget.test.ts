import test from "node:test";
import assert from "node:assert/strict";
import { classifyEntropyBudget, type OpenPull, type ProbeFacts } from "./entropy-budget.js";

const aligned: ProbeFacts = {
  conduitHealthStatus: 200,
  conduitReadyStatus: 200,
  conduitVersion: "0.8.0",
  conduitPersistence: "postgres",
  conduitContractRevision: "2026-10-03-ready-surface",
  resonanceReadyStatus: 503,
  resonanceMissing: ["SUPABASE_SERVICE_ROLE_KEY"],
  resonanceHasOwnerAction: false,
  resonanceHostClass: "public_gate",
};

const keepRed: OpenPull = {
  repo: "Conduit",
  number: 155,
  draft: false,
  doNotMerge: true,
  kind: "harden",
};

test("live 18:00 probe is owner-blocked and refuses net-new features", () => {
  const decision = classifyEntropyBudget(aligned, [keepRed, {
    repo: "Resonance",
    number: 149,
    draft: false,
    doNotMerge: false,
    kind: "docs",
  }]);
  assert.equal(decision.blockedPhase, "P1_owner_gates");
  assert.equal(decision.nextAction, "owner_gate");
  assert.equal(decision.allowNetNewFeature, false);
  assert.equal(decision.allowDocsRefresh, false);
  assert.equal(decision.reasons.includes("owner_missing_SUPABASE_SERVICE_ROLE_KEY"), true);
  assert.equal(decision.reasons.includes("resonance_ready_omits_ownerActionRequired"), true);
  assert.equal(JSON.stringify(decision).includes("eyJ"), false);
});

test("contract omission without the missing key is deploy lag, not an owner gate", () => {
  const decision = classifyEntropyBudget({
    ...aligned,
    resonanceMissing: [],
    resonanceHasOwnerAction: false,
  }, []);
  assert.equal(decision.blockedPhase, "P2_resonance_deploy_parity");
  assert.equal(decision.nextAction, "hold_deploy");
  assert.equal(decision.allowNetNewFeature, false);
});

test("an alias host cannot close the gate even when the body looks ready", () => {
  const decision = classifyEntropyBudget({
    ...aligned,
    resonanceReadyStatus: 200,
    resonanceMissing: [],
    resonanceHasOwnerAction: false,
    resonanceHostClass: "alias",
  }, []);
  assert.equal(decision.blockedPhase, "P2_resonance_deploy_parity");
  assert.equal(decision.reasons.includes("resonance_host_is_not_public_gate"), true);
  assert.equal(decision.allowNetNewFeature, false);
});

test("feature and harden count over the cap forces prune before any new scope", () => {
  const pulls: OpenPull[] = [1, 2, 3, 4, 5].map((number) => ({
    repo: "Conduit",
    number,
    draft: false,
    doNotMerge: false,
    kind: "harden",
  }));
  const decision = classifyEntropyBudget({
    ...aligned,
    resonanceReadyStatus: 200,
    resonanceMissing: [],
    resonanceHasOwnerAction: false,
  }, pulls);
  assert.equal(decision.blockedPhase, "P0_entropy_budget");
  assert.equal(decision.nextAction, "prune");
  assert.equal(decision.allowNetNewFeature, false);
});
