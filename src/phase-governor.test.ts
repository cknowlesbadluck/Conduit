import test from "node:test";
import assert from "node:assert/strict";
import { classifyBranch, decide, type Probe } from "./phase-governor.js";

const probe: Probe = {
  conduitHealth: 200,
  conduitReady: 200,
  conduitVersion: "0.8.0",
  contractRevision: "2026-10-03-ready-surface",
  persistence: "postgres",
  diagnosticsOk: true,
  resonanceReady: 503,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  readyBodyOmitsOwnerAction: true,
  vercelStatus: 404,
  vercelClass: "alias_absent",
  supabasePaused: true,
  deviceGateRecorded: false,
  persistenceProven: false,
  discretionaryOpen: { conduit: 1, resonance: 1, quicksilver: 1 },
  activityPruned: 0,
};

test("06:00 EDT probe is stuck on phase 0 and does not invent a delete", () => {
  const decision = decide(probe, [
    { repo: "Conduit", name: "main", openPull: null, divergedRelease: false },
    { repo: "Conduit", name: "release/0.8.0", openPull: null, divergedRelease: true },
    { repo: "Conduit", name: "feat/cutover-lattice-1000", openPull: 187, divergedRelease: false },
    { repo: "Conduit", name: "harden/ssl-and-signed-cursors", openPull: 162, divergedRelease: false },
  ]);
  assert.equal(decision.currentPhase, 0);
  assert.equal(decision.phases[1].state, "satisfied");
  assert.equal(decision.phases[2].state, "satisfied");
  assert.equal(decision.phases[8].blocker, "Phase 0 owner gate");
  assert.deepEqual(decision.deleteCandidates, []);
  assert.equal(classifyBranch({ repo: "Conduit", name: "release/0.8.0", openPull: null, divergedRelease: true }), "hold_diverged");
  assert.ok(decision.agentMustNot.some((rule) => rule.includes("invent")));
});

test("a clean owner gate opens persistence and still blocks an unrecorded device gate", () => {
  const open = decide(
    { ...probe, supabasePaused: false, missingRequired: [], resonanceReady: 200 },
    [],
  );
  assert.equal(open.currentPhase, 3);
  assert.equal(open.phases[0].state, "satisfied");
  assert.equal(open.phases[8].state, "blocked");
});

test("an unexpected ready body is not classified as the known owner gate", () => {
  const drifted = decide({ ...probe, missingRequired: ["OTHER"], readyBodyOmitsOwnerAction: false }, []);
  assert.equal(drifted.phases[2].state, "blocked");
  assert.match(drifted.phases[2].blocker ?? "", /drifted/);
});
