import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoSecretValues,
  classifyHostProbe,
  decideMerge,
  firstOpenPhase,
  redactProbe,
  type PhaseSlot,
} from "./phase-clock.js";

test("503 with a missing required name is an owner gate, not an alias", () => {
  const cls = classifyHostProbe({
    httpStatus: 503,
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    hasContractRevision: false,
    persistenceConfigured: false,
  });
  assert.equal(cls, "owner_gate");
});

test("404 DEPLOYMENT_NOT_FOUND is alias absence, not an owner gate", () => {
  assert.equal(
    classifyHostProbe({ httpStatus: 404, aliasError: "DEPLOYMENT_NOT_FOUND" }),
    "alias_absent",
  );
});

test("200 without the contract stamp is drift", () => {
  assert.equal(
    classifyHostProbe({ httpStatus: 200, hasContractRevision: false, persistenceConfigured: true }),
    "contract_drift",
  );
});

test("aligned 200 with persistence is ready", () => {
  assert.equal(
    classifyHostProbe({
      httpStatus: 200,
      hasContractRevision: true,
      ownerActionRequired: false,
      persistenceConfigured: true,
    }),
    "ready",
  );
});

test("clock stops on the first unsatisfied phase", () => {
  const slots: PhaseSlot[] = [
    { id: 1, name: "owner-gate", exitCriterion: "public ready 200", satisfied: false },
    { id: 2, name: "stamp", exitCriterion: "contractRevision present", satisfied: false },
    { id: 10, name: "acceptance", exitCriterion: "device archive", satisfied: false },
  ];
  const reading = firstOpenPhase(slots);
  assert.equal(reading.phase, 1);
  assert.equal(reading.blocker, "public ready 200");
  assert.equal(reading.advance, true);
});

test("keep-red and red required CI both refuse merge", () => {
  assert.equal(decideMerge({ keepRed: true, requiredCiGreen: true }).reason, "keep_red");
  assert.equal(decideMerge({ keepRed: false, requiredCiGreen: false }).reason, "required_ci_red");
  assert.equal(decideMerge({ keepRed: false, requiredCiGreen: true }).allow, true);
});

test("probe serialization does not carry a secret value", () => {
  const redacted = redactProbe({
    httpStatus: 503,
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  });
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
  assert.equal(assertNoSecretValues(serialized), true);
  assert.equal(serialized.includes("postgres://"), false);
});

test("404 stays alias absence even if a missing name is also present", () => {
  assert.equal(
    classifyHostProbe({
      httpStatus: 404,
      aliasError: "DEPLOYMENT_NOT_FOUND",
      missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    }),
    "alias_absent",
  );
});

test("redact drops secret values and keeps config names", () => {
  const redacted = redactProbe({
    httpStatus: 503,
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY", "postgres://user:secret@db/app", "eyJhbGciOiJIUzI1NiJ9.payload"],
    aliasError: "postgres://leak",
  });
  const serialized = JSON.stringify(redacted);
  assert.deepEqual(redacted.missingRequired, ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.equal(redacted.aliasError, null);
  assert.equal(assertNoSecretValues(serialized), true);
});
