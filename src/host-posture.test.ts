import test from "node:test";
import assert from "node:assert/strict";
import { KEEP_RED_PULLS, classifyHost, decidePosture, type ObservedHost, type OpenPull } from "./host-posture.js";

const live: ObservedHost[] = [
  {
    name: "conduit",
    httpStatus: 200,
    body: {
      status: "ready",
      service: "conduit",
      version: "0.8.0",
      contractRevision: "2026-10-03-ready-surface",
      persistence: "postgres",
    },
  },
  {
    name: "resonance",
    httpStatus: 503,
    body: {
      status: "not_ready",
      service: "resonance-nexus",
      stage: "deployment",
      production: true,
      authMode: "required",
      authModeOk: true,
      persistenceConfigured: false,
      githubAdapterConfigured: false,
      missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
      timestamp: "2026-10-08T18:01:50.291Z",
    },
  },
  {
    name: "vercel",
    httpStatus: 404,
    body: {},
    vercelError: "DEPLOYMENT_NOT_FOUND",
  },
];

const open: OpenPull[] = [
  { repo: "Conduit", number: 187, title: "feat: portfolio cutover lattice" },
  { repo: "Conduit", number: 162, title: "harden: shared Postgres TLS policy and optional HMAC cursors" },
  { repo: "Conduit", number: 155, title: "DB TLS: verify Postgres certificates by default" },
  { repo: "Conduit", number: 119, title: "keep red" },
  { repo: "Conduit", number: 120, title: "keep red" },
];

test("pins the 14:00 live hosts and does not treat alias absence as the owner gate", () => {
  assert.equal(classifyHost(live[0]), "ready");
  assert.equal(classifyHost(live[1]), "owner_gate");
  assert.equal(classifyHost(live[2]), "alias_absent");
});

test("refuses a new witness while the pin holds and the lattice pull request is open", () => {
  const decision = decidePosture(live, open);
  assert.equal(decision.pinHolds, true);
  assert.equal(decision.admitNewWitness, false);
  assert.deepEqual(decision.keepRed, [162, 155, 119, 120]);
  assert.match(decision.reason, /Refuse a new witness/);
});

test("a resonance body that includes contractRevision is drift, not a closed gate", () => {
  const drifted = live.map((host) =>
    host.name === "resonance" ? { ...host, body: { ...host.body, contractRevision: "leaked" } } : host,
  );
  const decision = decidePosture(drifted, open);
  assert.equal(decision.classes.resonance, "drift");
  assert.equal(decision.pinHolds, false);
  assert.equal(decision.admitNewWitness, true);
});

test("extra missing keys are not the owner gate", () => {
  const extra = live.map((host) =>
    host.name === "resonance"
      ? { ...host, body: { ...host.body, missingRequired: ["SUPABASE_SERVICE_ROLE_KEY", "OTHER"] } }
      : host,
  );
  assert.equal(classifyHost(extra[1]), "drift");
});

test("keep-red set is the TLS drafts and is not a merge instruction", () => {
  assert.deepEqual([...KEEP_RED_PULLS], [119, 120, 155, 162]);
  const decision = decidePosture(live, [{ repo: "Conduit", number: 187, title: "feat: portfolio cutover lattice" }]);
  assert.deepEqual(decision.keepRed, []);
  assert.equal(decision.admitNewWitness, false);
});
