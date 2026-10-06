import test from "node:test";
import assert from "node:assert/strict";
import { advanceLedger, classifyAlias, classifyPull, type HostProbe, type OpenPull } from "./phase-ledger.js";

const conduit: HostProbe = {
  service: "conduit",
  httpStatus: 200,
  persistence: "postgres",
  contractRevision: "2026-10-03-ready-surface",
};
const resonanceBlocked: HostProbe = {
  service: "resonance",
  httpStatus: 503,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  bodyHasOwnerAction: false,
};
const alias: HostProbe = { service: "vercel_alias", httpStatus: 404, alias: "absent" };
const pulls: OpenPull[] = [
  { repo: "Conduit", number: 182, title: "feat: project-agnostic degrade planner", draft: false, doNotMerge: false },
  { repo: "Conduit", number: 181, title: "⚡ Bolt: avoid temporary array allocation in event publisher", draft: false, doNotMerge: false },
  { repo: "Conduit", number: 119, title: "DRAFT KEEP RED: Add explicit ordered database migrations", draft: true, doNotMerge: true },
  { repo: "Conduit", number: 155, title: "DB TLS: verify Postgres certificates by default (DO NOT MERGE until Render env is set)", draft: false, doNotMerge: true },
];

test("live portfolio is stuck on the owner gate and does not treat the alias as that gate", () => {
  const state = advanceLedger({ probes: [conduit, resonanceBlocked, alias], pulls });
  assert.equal(state.phase, 1);
  assert.equal(state.name, "owner_ready_gate");
  assert.equal(state.advanced, false);
  assert.match(state.reason, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(state.reason, /alias is absent/);
  assert.equal(classifyAlias(alias), "alias_absent");
});

test("bolt and dependabot are collapse candidates; keep-red is not auto-closed", () => {
  assert.equal(classifyPull(pulls[1]), "collapse_candidate");
  assert.equal(classifyPull({ repo: "QuicksilverV1", number: 209, title: "chore(deps): bump actions/checkout from 4 to 7", draft: false, doNotMerge: false }), "collapse_candidate");
  assert.equal(classifyPull(pulls[2]), "keep_red");
  assert.equal(classifyPull(pulls[3]), "keep_red");
  assert.equal(classifyPull(pulls[0]), "refresh_in_place");
});

test("clearing the owner gate still refuses a witness pile and a keep-red merge", () => {
  const ready: HostProbe = { service: "resonance", httpStatus: 200, missingRequired: [], bodyHasOwnerAction: false };
  const piled = advanceLedger({
    probes: [conduit, ready],
    pulls: [
      pulls[0],
      { repo: "Resonance", number: 151, title: "feat: degrade planner for host probes", draft: false, doNotMerge: false },
    ],
  });
  assert.equal(piled.phase, 2);
  assert.equal(piled.name, "collapse_witness_pile");
  assert.match(piled.reason, /#182/);
  assert.match(piled.reason, /#151/);
  const held = advanceLedger({
    probes: [conduit, ready],
    pulls: [pulls[2], pulls[3]],
    tlsEnvSet: false,
  });
  assert.equal(held.phase, 3);
  assert.match(held.reason, /KEEP RED/);
});

test("device HG is not simulator CI, and release lock is unreachable before it", () => {
  const ready: HostProbe = { service: "resonance", httpStatus: 200, missingRequired: [], bodyHasOwnerAction: false };
  const state = advanceLedger({
    probes: [conduit, ready],
    pulls: [],
    tlsEnvSet: true,
    capabilityPlaneShipped: true,
    deviceHgPassed: false,
    legacyArchived: true,
    chamberLifecycleShipped: true,
    observabilityShipped: true,
  });
  assert.equal(state.phase, 5);
  assert.match(state.reason, /iPhone 16e/);
});

test("release lock requires every prior exit, including the legacy archive", () => {
  const ready: HostProbe = { service: "resonance", httpStatus: 200, missingRequired: [], bodyHasOwnerAction: false };
  const blocked = advanceLedger({
    probes: [conduit, ready],
    pulls: [],
    tlsEnvSet: true,
    capabilityPlaneShipped: true,
    deviceHgPassed: true,
    legacyArchived: false,
    chamberLifecycleShipped: true,
    observabilityShipped: true,
  });
  assert.equal(blocked.phase, 6);
  const done = advanceLedger({
    probes: [conduit, ready],
    pulls: [],
    tlsEnvSet: true,
    capabilityPlaneShipped: true,
    deviceHgPassed: true,
    legacyArchived: true,
    chamberLifecycleShipped: true,
    observabilityShipped: true,
  });
  assert.equal(done.phase, 9);
  assert.equal(done.advanced, true);
});
