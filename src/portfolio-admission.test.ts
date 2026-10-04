import test from "node:test";
import assert from "node:assert/strict";
import { ADMISSION_BUDGET, admitPortfolio, classifyProofHost, type PortfolioProbe } from "./portfolio-admission.js";

const alignedProbe = (): PortfolioProbe => ({
  conduitHealthStatus: 200,
  conduitReadyStatus: 200,
  conduitVersion: "0.8.0",
  conduitContractRevision: "2026-10-03-ready-surface",
  conduitPersistence: "postgres",
  surfaceSplit: "aligned",
  resonanceReadyStatus: 503,
  resonanceMissing: ["SUPABASE_SERVICE_ROLE_KEY"],
  resonanceHasOwnerActionRequired: false,
  resonanceHasContractRevision: false,
  resonanceHost: "resonancenexus.netlify.app",
  openNonHeldPulls: 12,
  deviceHgProven: false,
});

test("vercel alias is not Resonance proof", () => {
  assert.equal(classifyProofHost("resonancenexus.netlify.app"), "proof");
  assert.equal(classifyProofHost("resonance-git-main.vercel.app"), "alias");
  assert.equal(classifyProofHost("example.com"), "unknown");
});

test("owner service-role block outranks entropy and device HG", () => {
  const admission = admitPortfolio(alignedProbe());
  assert.equal(admission.action, "owner");
  assert.equal(admission.phase, 2);
  assert.equal(admission.admissible, false);
  assert.equal(admission.ownerBlocks.includes("resonance_service_role_missing"), true);
  assert.equal(admission.ownerBlocks.includes("quicksilver_device_hg_unproven"), true);
  assert.equal(JSON.stringify(admission).includes("SUPABASE_SERVICE_ROLE_KEY"), false);
});

test("entropy over budget is not admissible once the owner gate is clear", () => {
  const admission = admitPortfolio({
    ...alignedProbe(),
    resonanceReadyStatus: 200,
    resonanceMissing: [],
    openNonHeldPulls: ADMISSION_BUDGET + 1,
  });
  assert.equal(admission.action, "prune");
  assert.equal(admission.admissible, false);
});

test("unstamped ready pair is a surface fix, not a roadmap", () => {
  const admission = admitPortfolio({ ...alignedProbe(), surfaceSplit: "ready_missing_stamp" });
  assert.equal(admission.action, "implement");
  assert.equal(admission.phase, 1);
});

test("device HG stays owner-blocked after entropy is inside budget", () => {
  const admission = admitPortfolio({
    ...alignedProbe(),
    resonanceReadyStatus: 200,
    resonanceMissing: [],
    openNonHeldPulls: ADMISSION_BUDGET,
    deviceHgProven: false,
  });
  assert.equal(admission.action, "owner");
  assert.equal(admission.phase, 4);
});
