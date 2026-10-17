import test from "node:test";
import assert from "node:assert/strict";
import { HEALTH_CONTRACT_REVISION, classifySurfaceSplit, deployedCommitSha, healthBody, readyBody } from "./health-contract.js";
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

test("deployed commit comes from RENDER_GIT_COMMIT; absent or malformed reports unknown", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(deployedCommitSha({ RENDER_GIT_COMMIT: sha }), sha);
  assert.equal(deployedCommitSha({ RENDER_GIT_COMMIT: ` ${sha.toUpperCase()} ` }), sha);
  assert.equal(deployedCommitSha({}), "unknown");
  assert.equal(deployedCommitSha(undefined), "unknown");
  assert.equal(deployedCommitSha({ RENDER_GIT_COMMIT: "" }), "unknown");
  assert.equal(deployedCommitSha({ RENDER_GIT_COMMIT: "postgres://user:pass@host/db" }), "unknown");
  assert.equal(deployedCommitSha({ RENDER_GIT_COMMIT: "abc12" }), "unknown");
});

test("ready body carries commitSha (explicit, env-derived, or unknown) without changing the stamp", () => {
  const sha = "fedcba9876543210fedcba9876543210fedcba98";
  assert.equal(readyBody({ initialized: true, persistenceOk: true, persistence: "postgres", commitSha: sha }).commitSha, sha);
  const prior = process.env.RENDER_GIT_COMMIT;
  try {
    delete process.env.RENDER_GIT_COMMIT;
    assert.equal(readyBody({ initialized: true, persistenceOk: true, persistence: "memory" }).commitSha, "unknown");
    process.env.RENDER_GIT_COMMIT = sha;
    const body = readyBody({ initialized: true, persistenceOk: true, persistence: "memory" });
    assert.equal(body.commitSha, sha);
    assert.equal(body.contractRevision, HEALTH_CONTRACT_REVISION);
    assert.equal(classifySurfaceSplit(healthBody(), body), "aligned");
  } finally {
    if (prior === undefined) delete process.env.RENDER_GIT_COMMIT; else process.env.RENDER_GIT_COMMIT = prior;
  }
});
