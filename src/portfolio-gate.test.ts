import test from "node:test";
import assert from "node:assert/strict";
import { classifyPortfolioGate, CONDUIT_EXPECTED_REVISION, RESONANCE_OWNER_KEY } from "./portfolio-gate.js";

const liveConduitHealth = {
  httpStatus: 200,
  body: {
    status: "ok",
    service: "conduit",
    version: "0.8.0",
    contractRevision: CONDUIT_EXPECTED_REVISION,
  },
};

const liveConduitReady = {
  httpStatus: 200,
  body: {
    status: "ready",
    service: "conduit",
    version: "0.8.0",
    contractRevision: CONDUIT_EXPECTED_REVISION,
    persistence: "postgres",
  },
};

const liveResonance = {
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
    missingRequired: [RESONANCE_OWNER_KEY],
    timestamp: "2026-10-03T17:01:31.208Z",
  },
};

test("13:00 EDT live shape is owner-blocked, not a Conduit outage", () => {
  const verdict = classifyPortfolioGate({
    conduitHealth: liveConduitHealth,
    conduitReady: liveConduitReady,
    resonanceReady: liveResonance,
  });
  assert.equal(verdict.conduit, "ready");
  assert.equal(verdict.resonance, "owner_blocked");
  assert.equal(verdict.quicksilver, "device_gate");
  assert.equal(verdict.portfolio, "blocked_owner");
  assert.equal(verdict.deployLag, true);
  assert.equal(verdict.ownerActionRequiredFieldPresent, false);
  assert.equal(verdict.ownerAction?.includes(RESONANCE_OWNER_KEY), true);
  assert.equal(JSON.stringify(verdict).includes("eyJ"), false);
});

test("an extra missing key is not the owner gate", () => {
  const verdict = classifyPortfolioGate({
    conduitHealth: liveConduitHealth,
    conduitReady: liveConduitReady,
    resonanceReady: {
      httpStatus: 503,
      body: { ...liveResonance.body, missingRequired: [RESONANCE_OWNER_KEY, "GITHUB_TOKEN"] },
    },
  });
  assert.equal(verdict.resonance, "unexpected");
  assert.equal(verdict.portfolio, "blocked_resonance");
  assert.equal(verdict.ownerAction, null);
});

test("health 200 without the stamp is a surface split", () => {
  const verdict = classifyPortfolioGate({
    conduitHealth: { httpStatus: 200, body: { status: "ok", service: "conduit" } },
    conduitReady: liveConduitReady,
    resonanceReady: liveResonance,
  });
  assert.equal(verdict.conduit, "surface_split");
  assert.equal(verdict.portfolio, "blocked_owner");
});

test("stamped resonance 200 opens the portfolio only after Conduit is ready", () => {
  const ready = classifyPortfolioGate({
    conduitHealth: liveConduitHealth,
    conduitReady: liveConduitReady,
    resonanceReady: {
      httpStatus: 200,
      body: { status: "ready", contractRevision: "2026-10-03-ready-surface", ownerActionRequired: false },
    },
  });
  assert.equal(ready.resonance, "ready");
  assert.equal(ready.deployLag, false);
  assert.equal(ready.ownerActionRequiredFieldPresent, true);
  assert.equal(ready.portfolio, "open");
  assert.equal(ready.quicksilver, "device_gate");
});

test("malformed resonance body fails closed", () => {
  const verdict = classifyPortfolioGate({
    conduitHealth: liveConduitHealth,
    conduitReady: liveConduitReady,
    resonanceReady: { httpStatus: 503, body: "nope" },
  });
  assert.equal(verdict.resonance, "malformed");
  assert.equal(verdict.portfolio, "blocked_resonance");
});
