import test from "node:test";
import assert from "node:assert/strict";
import { classifyPull, classifySaturation, buildRoadmap, collapseWitnesses } from "./portfolio-saturation.js";

test("keep-red heads are never mergeable", () => {
  assert.equal(classifyPull({ repo: "Conduit", number: 119, title: "DRAFT KEEP RED", draft: true, head: "codex/add-event-stream-manager-module" }), "keep-red");
  assert.equal(classifyPull({ repo: "Conduit", number: 155, title: "DB TLS: verify (DO NOT MERGE)", draft: false, head: "counsel/db-tls-verify" }), "keep-red");
  assert.equal(classifyPull({ repo: "Conduit", number: 162, title: "harden ssl", draft: false, head: "harden/ssl-and-signed-cursors" }), "keep-red");
});

test("witness and product are distinct from dependabot", () => {
  assert.equal(classifyPull({ repo: "Conduit", number: 177, title: "feat: project-agnostic ten-phase portfolio machine", draft: false, head: "harden/phase-machine-1000" }), "witness");
  assert.equal(classifyPull({ repo: "QuicksilverV1", number: 224, title: "feat: cloud context policy choke point", draft: false, head: "feat/cloud-context-policy" }), "product");
  assert.equal(classifyPull({ repo: "QuicksilverV1", number: 209, title: "chore(deps): bump actions", draft: false, head: "dependabot/github_actions/actions-640176b5ab" }), "dependabot");
});

test("current portfolio admits one more witness and no product pull", () => {
  const verdict = classifySaturation({
    pulls: [
      { repo: "Conduit", number: 177, title: "feat: phase machine", draft: false, head: "harden/phase-machine-1000" },
      { repo: "Conduit", number: 176, title: "feat: admission budget", draft: false, head: "harden/admission-budget-0800" },
      { repo: "Conduit", number: 119, title: "DRAFT KEEP RED", draft: true, head: "codex/add-event-stream-manager-module" },
      { repo: "QuicksilverV1", number: 224, title: "feat: cloud context policy", draft: false, head: "feat/cloud-context-policy" },
      { repo: "Resonance", number: 133, title: "Audit fixes", draft: false, head: "counsel/audit-fixes" },
    ],
    projects: [
      { id: "conduit", healthStatus: 200, readyStatus: 200, missingRequired: [], ownerGates: [], orphanBranches: 0 },
      { id: "resonance", healthStatus: 200, readyStatus: 503, missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"], omittedFields: ["ownerActionRequired", "contractRevision"], ownerGates: ["set SUPABASE_SERVICE_ROLE_KEY on resonancenexus only"] },
      { id: "quicksilver", healthStatus: 200, readyStatus: 200, ownerGates: ["device proof on iPhone 16e"], orphanBranches: 0 },
    ],
    budget: { maxOpenWitnessPulls: 3, maxOpenProductPulls: 2 },
  });
  assert.equal(verdict.secretsInvented, false);
  assert.equal(verdict.admitAnotherWitness, true);
  assert.equal(verdict.admitAnotherProduct, false);
  assert.equal(verdict.doNotMerge.includes(119), true);
  assert.equal(verdict.doNotMerge.includes(177), true);
  assert.equal(verdict.doNotClose.includes(119), true);
  assert.equal(verdict.doNotClose.includes(224), true);
  assert.equal(verdict.ownerActions.some((action) => action.includes("SUPABASE_SERVICE_ROLE_KEY")), true);
  assert.equal(verdict.ownerActions.some((action) => action.includes("eyJ")), false);
  assert.equal(verdict.roadmap.length, 10);
  assert.equal(verdict.roadmap[2].status, "blocked");
});

test("a full witness budget refuses another witness", () => {
  const verdict = classifySaturation({
    pulls: [
      { repo: "Conduit", number: 1, title: "witness", draft: false, head: "harden/a" },
      { repo: "Conduit", number: 2, title: "witness", draft: false, head: "harden/b" },
      { repo: "Conduit", number: 3, title: "witness", draft: false, head: "harden/c" },
    ],
    projects: [{ id: "conduit", healthStatus: 200, readyStatus: 200 }],
  });
  assert.equal(verdict.admitAnotherWitness, false);
  assert.equal(verdict.agentActions.some((action) => action.includes("witness budget full")), true);
  assert.equal(verdict.collapse.survivor, 3);
  assert.deepEqual(verdict.collapse.collapseCandidates, [2, 1]);
});

test("roadmap is ten phases and does not treat a named missing key as an agent task", () => {
  const roadmap = buildRoadmap([
    { id: "resonance", healthStatus: 200, readyStatus: 503, missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"], omittedFields: ["ownerActionRequired"] },
  ]);
  assert.equal(roadmap.length, 10);
  assert.equal(roadmap[0].status, "done");
  assert.equal(roadmap[1].status, "done");
  assert.equal(roadmap[2].status, "blocked");
  assert.equal(roadmap[2].blocker?.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
});

test("secret-looking missing names are dropped", () => {
  const verdict = classifySaturation({
    pulls: [],
    projects: [{ id: "resonance", healthStatus: 200, readyStatus: 503, missingRequired: ["eyJhbGciOi", "SUPABASE_SERVICE_ROLE_KEY"] }],
  });
  assert.equal(verdict.ownerActions.length, 1);
  assert.equal(verdict.ownerActions[0].includes("SUPABASE_SERVICE_ROLE_KEY"), true);
});

test("noon stack collapses older witnesses and protects keep-red and product", () => {
  const pulls = [
    { repo: "Conduit", number: 178, title: "feat: portfolio saturation witness", draft: false, head: "harden/saturation-witness-1100" },
    { repo: "Conduit", number: 177, title: "feat: project-agnostic ten-phase portfolio machine", draft: false, head: "harden/phase-machine-1000" },
    { repo: "Conduit", number: 176, title: "feat: portfolio admission budget", draft: false, head: "harden/admission-budget-0800" },
    { repo: "Conduit", number: 162, title: "harden: shared Postgres TLS", draft: false, head: "harden/ssl-and-signed-cursors" },
    { repo: "Conduit", number: 119, title: "DRAFT KEEP RED", draft: true, head: "codex/add-event-stream-manager-module" },
    { repo: "QuicksilverV1", number: 224, title: "feat: cloud context policy choke point", draft: false, head: "feat/cloud-context-policy" },
    { repo: "Resonance", number: 133, title: "Audit fixes", draft: false, head: "counsel/audit-fixes" },
  ];
  const collapse = collapseWitnesses(pulls);
  assert.equal(collapse.survivor, 178);
  assert.deepEqual(collapse.collapseCandidates, [177, 176]);
  assert.equal(collapse.protected.includes(119), true);
  assert.equal(collapse.protected.includes(162), true);
  assert.equal(collapse.protected.includes(224), true);
  assert.equal(collapse.protected.includes(133), true);
  assert.equal(collapse.collapseCandidates.includes(119), false);
  const verdict = classifySaturation({
    pulls,
    projects: [
      { id: "conduit", healthStatus: 200, readyStatus: 200, orphanBranches: 0 },
      { id: "resonance", healthStatus: 200, readyStatus: 503, missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"], omittedFields: ["ownerActionRequired", "contractRevision"] },
    ],
  });
  assert.equal(verdict.admitAnotherWitness, false);
  assert.equal(verdict.secretsInvented, false);
  assert.equal(verdict.agentActions.some((action) => action.includes("do not close until folded")), true);
});
