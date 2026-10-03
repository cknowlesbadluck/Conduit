import test from "node:test";
import assert from "node:assert/strict";
import { HEALTH_CONTRACT_REVISION, classifySurfaceSplit, healthBody, readyBody } from "./health-contract.js";
import { VERSION } from "./version.js";

test("health body carries version and the parity stamp", () => {
  const body = healthBody();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "conduit");
  assert.equal(body.version, VERSION);
  assert.equal(body.contractRevision, HEALTH_CONTRACT_REVISION);
  assert.equal(JSON.stringify(body).includes("DATABASE_URL"), false);
});

test("ready body shares the health stamp and does not leak the database url", () => {
  const body = readyBody({ initialized: true, persistenceOk: true, persistence: "postgres" });
  assert.equal(body.status, "ready");
  assert.equal(body.version, VERSION);
  assert.equal(body.contractRevision, HEALTH_CONTRACT_REVISION);
  assert.equal(body.persistence, "postgres");
  assert.equal(JSON.stringify(body).includes("DATABASE_URL"), false);
});

test("ready is degraded only after init when persistence fails", () => {
  assert.equal(readyBody({ initialized: false, persistenceOk: false, persistence: "memory" }).status, "initializing");
  assert.equal(readyBody({ initialized: true, persistenceOk: false, persistence: "postgres" }).status, "degraded");
});

test("live ready without the stamp is a surface split", () => {
  const split = classifySurfaceSplit(
    { status: "ok", service: "conduit", version: "0.8.0", contractRevision: HEALTH_CONTRACT_REVISION },
    { status: "ready", service: "conduit", version: "0.8.0", persistence: "postgres" },
  );
  assert.equal(split, "ready_missing_stamp");
  assert.equal(classifySurfaceSplit(healthBody(), readyBody({ initialized: true, persistenceOk: true, persistence: "memory" })), "aligned");
});
