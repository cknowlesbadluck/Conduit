import test from "node:test";
import assert from "node:assert/strict";
import { classifyFingerprint, classifyPass, classifyPersistence } from "./inactive-fingerprint.js";

test("known stranger analytics beats a spoofed portfolio marker", () => {
  const decision = classifyFingerprint({
    host: "quicksilver.vercel.app",
    status: 200,
    body: "<!DOCTYPE html><html><title>Canawan</title>quicksilverv1 UA-160004791-1</html>",
  });
  assert.equal(decision.classification, "stranger_occupant");
  assert.equal(decision.spoofedMarker, true);
  assert.equal(decision.phaseAdmitted, false);
});

test("Detail Framework is stranger_occupant and not phase-admitted", () => {
  const decision = classifyFingerprint({
    host: "resonance.vercel.app",
    status: 200,
    body: "<!DOCTYPE html><html><title>Detail Framework</title>data-cruncher</html>",
  });
  assert.equal(decision.classification, "stranger_occupant");
  assert.equal(decision.phaseAdmitted, false);
});

test("INACTIVE projects are not persistence", () => {
  const persistence = classifyPersistence([
    { name: "Resonance", status: "INACTIVE" },
    { name: "Quicksilver: Mercurial intelligence", status: "INACTIVE" },
    { name: "WhereamI?", status: "INACTIVE" },
  ]);
  assert.equal(persistence.persistenceProof, false);
  assert.equal(persistence.phaseAdmitted, false);
  assert.equal(persistence.inactiveNames.length, 3);
});

test("ready 503 plus inactive projects stays owner_blocked at phase 0", () => {
  const pass = classifyPass({
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    projects: [{ name: "Resonance", status: "INACTIVE" }],
    deviceRecorded: false,
  });
  assert.equal(pass.classification, "owner_blocked");
  assert.equal(pass.evidenceOnly, true);
  assert.equal(pass.highestAdmittedPhase, 0);
  assert.equal(pass.phaseAdmitted, false);
  assert.match(pass.bindingConstraint, /device HG unrecorded/);
});
