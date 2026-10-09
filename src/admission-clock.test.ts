import test from "node:test";
import assert from "node:assert/strict";
import { admit } from "./admission-clock.js";

const liveReady = {
  httpStatus: 503,
  body: JSON.stringify({
    status: "not_ready",
    service: "resonance-nexus",
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  }),
};

test("live 503 holds phase 1 and does not treat the alias 404 as the gate", () => {
  const admission = admit({
    resonanceReady: liveReady,
    alias: { httpStatus: 404, body: "404 DEPLOYMENT_NOT_FOUND" },
    device: { httpStatus: 200, body: JSON.stringify({ deviceAcceptance: "not_recorded" }) },
  });
  assert.equal(admission.revision, "2026-10-09-admission-clock");
  assert.equal(admission.phase, 1);
  assert.equal(admission.bindingConstraint, "owner_persistence_gate");
  assert.equal(admission.ownerGate, true);
  assert.equal(admission.aliasAbsent, true);
  assert.equal(admission.deviceRecorded, false);
  assert.equal(admission.productionProof, false);
  assert.equal(admission.refuseMergeLattice, true);
});

test("a ready device health body still does not record acceptance", () => {
  const admission = admit({
    resonanceReady: { httpStatus: 200, body: JSON.stringify({ status: "ready" }) },
    alias: { httpStatus: 200, body: JSON.stringify({ status: "ready" }) },
    device: { httpStatus: 200, body: JSON.stringify({ status: "ready", ok: true }) },
  });
  assert.equal(admission.phase, 2);
  assert.equal(admission.ownerGate, false);
  assert.equal(admission.deviceRecorded, false);
  assert.equal(admission.productionProof, false);
});
