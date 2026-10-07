import test from "node:test";
import assert from "node:assert/strict";
import { classifyHostProbe, redactPosture } from "./host-posture.js";

test("vercel 404 is alias absence, not an owner gate", () => {
  const decision = classifyHostProbe({
    httpStatus: 404,
    body: "The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND",
  });
  assert.equal(decision.posture, "alias_absent");
  assert.equal(decision.missingRequired.length, 0);
});

test("503 missing the service role key is owner-blocked and does not invent a value", () => {
  const decision = classifyHostProbe({
    httpStatus: 503,
    body: {
      status: "not_ready",
      missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
      authMode: "required",
      authModeOk: true,
    },
  });
  assert.equal(decision.posture, "owner_blocked");
  assert.deepEqual(decision.missingRequired, ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.equal(JSON.stringify(decision).includes("eyJ"), false);
});

test("same 503 is deploy lag when source already emits the contract fields", () => {
  const decision = classifyHostProbe({
    httpStatus: 503,
    sourceEmitsContract: true,
    body: { status: "not_ready", missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"] },
  });
  assert.equal(decision.posture, "deploy_lag");
  assert.equal(decision.contractFieldsPresent, false);
});

test("ready 200 stays ready even if a missing list is empty", () => {
  const decision = classifyHostProbe({
    httpStatus: 200,
    body: { status: "ready", contractRevision: "2026-10-03-ready-surface", persistence: "postgres" },
  });
  assert.equal(decision.posture, "ready");
  assert.equal(decision.contractFieldsPresent, true);
});

test("redaction never echoes a secret value", () => {
  const decision = redactPosture({
    posture: "owner_blocked",
    reason: "blocked DATABASE_URL=postgres://user:secret@host/db",
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY=should-not-appear"],
    contractFieldsPresent: false,
  });
  assert.equal(decision.reason.includes("postgres://"), false);
  assert.equal(decision.missingRequired[0].includes("should-not-appear"), false);
});
