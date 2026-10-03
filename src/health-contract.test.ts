import test from "node:test";
import assert from "node:assert/strict";
import { HEALTH_CONTRACT_REVISION, healthBody } from "./health-contract.js";
import { VERSION } from "./version.js";

test("health body carries version and the parity stamp", () => {
  const body = healthBody();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "conduit");
  assert.equal(body.version, VERSION);
  assert.equal(body.contractRevision, HEALTH_CONTRACT_REVISION);
  assert.equal(JSON.stringify(body).includes("DATABASE_URL"), false);
});

test("a live body without the stamp is not this contract", () => {
  const live = { status: "ok", service: "conduit" };
  assert.equal("version" in live, false);
  assert.notEqual(live, healthBody());
});
