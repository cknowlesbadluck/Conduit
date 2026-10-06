import test from "node:test";
import assert from "node:assert/strict";
import { planDegrade } from "./degrade.js";

test("503 with a setting name is an owner gate and does not echo values", () => {
  const plan = planDegrade({
    status: 503,
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY", "postgres://user:secret@db/app"],
    bodyText: "eyJhbGciOiJIUzI1NiJ9.payload",
  });
  assert.deepEqual(plan, {
    host: "owner_gate",
    action: "ask_owner",
    retryable: false,
    missingNames: ["SUPABASE_SERVICE_ROLE_KEY"],
  });
  assert.equal(/postgres:|eyJ|secret/i.test(JSON.stringify(plan)), false);
});

test("DEPLOYMENT_NOT_FOUND is an absent alias, not an owner gate", () => {
  const plan = planDegrade({
    status: 404,
    bodyText: "DEPLOYMENT_NOT_FOUND",
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
  });
  assert.equal(plan.action, "ignore_alias");
  assert.equal(plan.host, "alias_absent");
  assert.deepEqual(plan.missingNames, []);
});

test("budget exhaustion stays local and rate limits back off", () => {
  assert.equal(planDegrade({ status: 200, code: "budget_exhausted" }).action, "stay_local");
  assert.equal(planDegrade({ status: 429 }).retryable, true);
  assert.equal(planDegrade({ status: 429 }).action, "backoff");
});

test("401 reauths, clean 200 proceeds, unknown fails closed", () => {
  assert.equal(planDegrade({ status: 401 }).action, "reauth");
  assert.equal(planDegrade({ status: 200, code: "ready" }).action, "proceed");
  assert.equal(planDegrade({ status: 500, bodyText: "boom" }).action, "stay_local");
});
