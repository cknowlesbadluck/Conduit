import test from "node:test";
import assert from "node:assert/strict";
import { OPEN_PR_BUDGET, classifyHost, decideCutover, discretionaryOpen } from "./cutover-lattice.js";

const conduit = { name: "conduit", httpStatus: 200, missingRequired: [], bodyHasContractRevision: true, bodyHasOwnerActionRequired: false };
const resonanceGated = { name: "resonance", httpStatus: 503, missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"], bodyHasContractRevision: false, bodyHasOwnerActionRequired: false };
const vercelAlias = { name: "vercel", httpStatus: 404, deploymentNotFound: true };
const resonanceDb = { name: "supabase:Resonance", httpStatus: null, projectPaused: true };
const liveEntropy = [
  { repo: "Conduit", openPullRequests: 5, keepRed: 4 },
  { repo: "Resonance", openPullRequests: 1, keepRed: 0 },
  { repo: "QuicksilverV1", openPullRequests: 3, keepRed: 0 },
  { repo: "Quicksilver", openPullRequests: 2, keepRed: 0, archived: true },
];

test("classifies live portfolio hosts without treating alias absence as an owner gate", () => {
  assert.equal(classifyHost(conduit), "ready");
  assert.equal(classifyHost(resonanceGated), "owner_gated");
  assert.equal(classifyHost(vercelAlias), "alias_absent");
  assert.equal(classifyHost(resonanceDb), "project_paused");
});

test("keep-red and archived repositories do not count as discretionary entropy", () => {
  assert.equal(discretionaryOpen(liveEntropy[0]), 1);
  assert.equal(discretionaryOpen(liveEntropy[3]), 0);
});

test("paused Supabase is an owner gate even if the Netlify key were present", () => {
  const decision = decideCutover({
    hosts: [conduit, { name: "resonance", httpStatus: 200, missingRequired: [] }, resonanceDb, vercelAlias],
    repos: liveEntropy,
    legacyQuicksilverArchived: true,
    latticeFamilyOpen: true,
  });
  assert.equal(decision.admittedPhase, "p0_owner_gates");
  assert.equal(decision.admission, "owner_only");
  assert.equal(decision.ownerActions.some((item) => item.includes("Unpause Supabase")), true);
  assert.equal(decision.ownerActions.some((item) => item.includes("Do not invent")), false);
});

test("current portfolio admits only the owner gate", () => {
  const decision = decideCutover({
    hosts: [conduit, resonanceGated, resonanceDb, vercelAlias],
    repos: liveEntropy,
    legacyQuicksilverArchived: true,
    latticeFamilyOpen: true,
  });
  assert.equal(decision.admittedPhase, "p0_owner_gates");
  assert.equal(decision.admission, "owner_only");
  assert.equal(decision.entropyBreach, true);
  assert.equal(decision.revision, "2026-10-09-paused-project");
  assert.equal(decision.ownerActions.some((item) => item.includes("Do not invent")), true);
  assert.equal(decision.ownerActions.some((item) => item.includes("is archived")), true);
  assert.equal(decision.ownerActions[0].includes("supabase:Resonance"), true);
});

test("closed owner gate with keep-red only does not admit entropy collapse", () => {
  const decision = decideCutover({
    hosts: [conduit, { name: "resonance", httpStatus: 200, missingRequired: [] }],
    repos: [{ repo: "Conduit", openPullRequests: 5, keepRed: 4 }],
    legacyQuicksilverArchived: true,
  });
  assert.equal(decision.entropyBreach, false);
  assert.equal(decision.admittedPhase, "p2_ready_parity");
  assert.equal(OPEN_PR_BUDGET, 2);
});
