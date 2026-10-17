import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeToRecord, inspectLeak } from "./leak-fence.js";

const LIVE_READY = JSON.stringify({
  status: "not_ready",
  service: "resonance-nexus",
  stage: "deployment",
  production: true,
  authMode: "required",
  authModeOk: true,
  persistenceConfigured: false,
  githubAdapterConfigured: false,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  timestamp: "2026-10-09T20:01:33.328Z",
});

test("a required-key name is not a leak and is not phase admission", () => {
  const decision = inspectLeak(LIVE_READY);
  assert.equal(decision.leaked, false);
  assert.equal(decision.phaseAdmitted, false);
  assert.deepEqual(decision.kinds, []);
  assert.equal(assertSafeToRecord(LIVE_READY), LIVE_READY);
  assert.equal(LIVE_READY.includes("ownerActionRequired"), false);
  assert.equal(LIVE_READY.includes("contractRevision"), false);
});

test("a jwt shape is refused and the token is not echoed", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturevalue";
  const decision = inspectLeak(`missing ${token}`);
  assert.equal(decision.leaked, true);
  assert.equal(decision.kinds.includes("jwt"), true);
  assert.equal(decision.redacted.includes(token), false);
  assert.equal(decision.phaseAdmitted, false);
  assert.throws(() => assertSafeToRecord(`body ${token}`), /jwt/);
  try {
    assertSafeToRecord(`body ${token}`);
  } catch (error) {
    assert.equal(String(error).includes(token), false);
  }
});

test("sb_secret and passworded postgres urls are refused", () => {
  const secret = "sb_secret_examplevalue123";
  const url = "postgresql://owner:not-a-real-password@db.example.co/postgres";
  const decision = inspectLeak(`${secret} ${url}`);
  assert.equal(decision.leaked, true);
  assert.deepEqual(decision.kinds, ["sb_secret", "postgres_url_with_password"]);
  assert.equal(decision.redacted.includes(secret), false);
  assert.equal(decision.redacted.includes("not-a-real-password"), false);
});
