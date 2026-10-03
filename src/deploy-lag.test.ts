import test from "node:test";
import assert from "node:assert/strict";
import { classifyLiveProof } from "./deploy-lag.js";

test("a 503 missing the service role is an owner gate, not a code failure", () => {
  const verdict = classifyLiveProof({
    httpStatus: 503,
    body: {
      status: "not_ready",
      missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    },
  });
  assert.equal(verdict.class, "owner-blocked");
});

test("Conduit health 200 without the committed version is deploy lag", () => {
  const verdict = classifyLiveProof(
    { httpStatus: 200, body: { status: "ok", service: "conduit" } },
    { version: "0.8.0" },
  );
  assert.equal(verdict.class, "deploy-lag");
});

test("matching contract revision is the only live proof", () => {
  const verdict = classifyLiveProof(
    { httpStatus: 200, body: { status: "ok", contractRevision: "fcd99ff" } },
    { contractRevision: "fcd99ff" },
  );
  assert.equal(verdict.class, "live-proof");
});

test("non-200 without the owner secret is unproven", () => {
  const verdict = classifyLiveProof({ httpStatus: 502, body: {} });
  assert.equal(verdict.class, "unproven");
});
