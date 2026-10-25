import test from "node:test";
import assert from "node:assert/strict";
import { readyBody, HEALTH_CONTRACT_REVISION } from "./health-contract.js";

test("readyBody.production derives from NODE_ENV and is additive", () => {
  const orig = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const prod = readyBody({ initialized: true, persistenceOk: true, persistence: "postgres" });
    assert.equal(prod.production, true);
    assert.equal(prod.status, "ready");
    assert.equal(prod.contractRevision, HEALTH_CONTRACT_REVISION);
    process.env.NODE_ENV = "test";
    assert.equal(readyBody({ initialized: true, persistenceOk: true, persistence: "memory" }).production, false);
    delete process.env.NODE_ENV;
    assert.equal(readyBody({ initialized: false, persistenceOk: false, persistence: "memory" }).production, false);
  } finally {
    if (orig === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = orig;
  }
});
