import test from "node:test";
import assert from "node:assert/strict";
import { classifyProbe } from "./probe-verdict.js";

test("a 404 alias is not an owner gate", () => {
  const result = classifyProbe({
    httpStatus: 404,
    body: "The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND",
  });
  assert.equal(result.verdict, "alias_absent");
  assert.equal(result.productionProof, false);
});

test("a missing required key is an owner gate even without the newer stamp", () => {
  const result = classifyProbe({
    httpStatus: 503,
    body: JSON.stringify({
      status: "not_ready",
      missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    }),
  });
  assert.equal(result.verdict, "owner_gate");
  assert.equal(result.deployLag, true);
  assert.deepEqual(result.missingRequired, ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.equal(result.productionProof, false);
});

test("ready persistence is not production proof", () => {
  const result = classifyProbe({
    httpStatus: 200,
    body: JSON.stringify({
      status: "ready",
      version: "0.8.0",
      contractRevision: "2026-10-03-ready-surface",
      persistence: "postgres",
    }),
  });
  assert.equal(result.verdict, "ready");
  assert.equal(result.productionProof, false);
});

test("gateway health cannot record device acceptance", () => {
  const result = classifyProbe({
    httpStatus: 200,
    body: JSON.stringify({
      ok: true,
      service: "mercury-gateway",
      deviceAcceptance: "not_recorded",
      acceptanceGate: "CHR-55",
    }),
  });
  assert.equal(result.verdict, "device_not_recorded");
  assert.equal(result.productionProof, false);
});

test("non-json failure is unreadable", () => {
  assert.equal(classifyProbe({ httpStatus: 500, body: "<html>bad" }).verdict, "unreadable");
});
