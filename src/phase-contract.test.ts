import test from "node:test";
import assert from "node:assert/strict";
import { PHASES, classifyProbe, assertNoSecretInvention, assertStampDoesNotAdvance } from "./phase-contract.js";

const live = {
  resonanceStatus: 503,
  resonanceMissing: ["SUPABASE_SERVICE_ROLE_KEY"],
  vercelStatus: 404,
  supabasePaused: true,
  deviceHgRecorded: false
};

test("ten phases, owner gate is phase 2", () => {
  assert.equal(PHASES.length, 10);
  assert.equal(PHASES[1].owner, "owner");
  const classified = classifyProbe(live);
  assert.equal(classified.currentPhase, 2);
  assert.equal(classified.ownerBlocked, true);
  assert.equal(classified.aliasAbsent, true);
  assert.equal(classified.secretsInvented, false);
});

test("stamp cannot clear owner gate or invent a secret", () => {
  const before = classifyProbe(live);
  assert.throws(() => assertStampDoesNotAdvance(before, { ...before, ownerBlocked: false }));
  assert.throws(() => assertNoSecretInvention({ key: "eyJhbGciOi" }));
  assert.doesNotThrow(() => assertNoSecretInvention({ missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"] }));
});

test("device fence stays closed while owner gate is open", () => {
  const classified = classifyProbe({ ...live, deviceHgRecorded: true });
  assert.equal(classified.currentPhase, 2);
});
