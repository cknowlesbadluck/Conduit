import test from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_PR_BUDGET,
  classifyHost,
  decideCutover,
  type HostProbe,
  type RepoEntropy,
} from "./cutover-lattice.js";

const conduit: HostProbe = {
  name: "conduit",
  httpStatus: 200,
  missingRequired: [],
  bodyHasContractRevision: true,
  bodyHasOwnerActionRequired: false,
};

const resonanceGated: HostProbe = {
  name: "resonance",
  httpStatus: 503,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  bodyHasContractRevision: false,
  bodyHasOwnerActionRequired: false,
};

const vercelAlias: HostProbe = {
  name: "vercel",
  httpStatus: 404,
  deploymentNotFound: true,
};

const entropy: RepoEntropy[] = [
  { repo: "Conduit", openPullRequests: 8, keepRed: 4 },
  { repo: "Resonance", openPullRequests: 3, keepRed: 0 },
  { repo: "QuicksilverV1", openPullRequests: 4, keepRed: 0 },
];

test("classifies live portfolio hosts without treating alias absence as an owner gate", () => {
  assert.equal(classifyHost(conduit), "ready");
  assert.equal(classifyHost(resonanceGated), "owner_gated");
  assert.equal(classifyHost(vercelAlias), "alias_absent");
  assert.equal(classifyHost({ name: "unknown", httpStatus: null }), "unprobed");
});

test("current portfolio admits only the owner gate and refuses later phases", () => {
  const decision = decideCutover({ hosts: [conduit, resonanceGated, vercelAlias], repos: entropy });
  assert.equal(decision.admittedPhase, "p0_owner_gates");
  assert.equal(decision.admission, "owner_only");
  assert.equal(decision.entropyBreach, true);
  assert.equal(decision.refusedPhases.includes("p8_device_acceptance"), true);
  assert.equal(decision.ownerActions.some((item) => item.includes("SUPABASE_SERVICE_ROLE_KEY")), true);
  assert.equal(decision.ownerActions.some((item) => item.includes("alias_absent")), true);
});

test("public contract drift stays on the owner gate even if entropy is inside budget", () => {
  const drifted = { ...resonanceGated, bodyHasContractRevision: true };
  const decision = decideCutover({
    hosts: [conduit, drifted],
    repos: [{ repo: "Resonance", openPullRequests: OPEN_PR_BUDGET, keepRed: 0 }],
  });
  assert.equal(decision.admittedPhase, "p0_owner_gates");
  assert.match(decision.reason, /drifted/);
});

test("closed owner gate with too many open pull requests admits entropy collapse only", () => {
  const decision = decideCutover({
    hosts: [conduit, { name: "resonance", httpStatus: 200, missingRequired: [] }],
    repos: entropy,
    persistenceProof: true,
    executionProof: true,
  });
  assert.equal(decision.admittedPhase, "p1_entropy_collapse");
  assert.equal(decision.admission, "implement");
  assert.equal(decision.refusedPhases.includes("p4_idempotent_execution"), true);
});

test("inside budget and no persistence proof admits ready parity, not a feature slice", () => {
  const decision = decideCutover({
    hosts: [conduit, { name: "resonance", httpStatus: 200, missingRequired: [] }],
    repos: [{ repo: "Resonance", openPullRequests: 1, keepRed: 0 }],
  });
  assert.equal(decision.admittedPhase, "p2_ready_parity");
  assert.equal(decision.entropyBreach, false);
});

test("ready parity proved admits persistence, and full proofs admit release hardening", () => {
  const hosts = [conduit, { name: "resonance", httpStatus: 200, missingRequired: [] }];
  const repos = [{ repo: "Resonance", openPullRequests: 1, keepRed: 0 }];
  const persistence = decideCutover({ hosts, repos, readyParityProof: true });
  assert.equal(persistence.admittedPhase, "p3_persistence_proof");
  const release = decideCutover({
    hosts,
    repos,
    readyParityProof: true,
    persistenceProof: true,
    executionProof: true,
    adapterSubstitutionProof: true,
    chamberProof: true,
    iosContractProof: true,
    deviceAcceptanceProof: true,
  });
  assert.equal(release.admittedPhase, "p9_release_hardening");
  assert.equal(release.admission, "implement");
});

test("does not invent a secret and does not claim device acceptance from simulator facts", () => {
  const decision = decideCutover({ hosts: [resonanceGated], repos: [] });
  assert.equal(decision.ownerActions.some((item) => item.includes("Do not invent")), true);
  assert.equal(decision.ownerActions.some((item) => item.includes("iPhone 16e")), true);
  assert.equal(decision.admittedPhase === "p8_device_acceptance", false);
});
