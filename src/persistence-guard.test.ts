import test from "node:test";
import assert from "node:assert/strict";
import { assertPersistenceConfig, persistenceConfigError } from "./persistence-guard.js";

test("production + CONDUIT_TEST_MEMORY=true refuses to boot", () => {
  assert.throws(() => assertPersistenceConfig({ NODE_ENV: "production", CONDUIT_TEST_MEMORY: "true", DATABASE_URL: "postgres://x" }), /test-only/);
});
test("unset or development NODE_ENV with the switch is refused (explicit test mode only)", () => {
  assert.match(persistenceConfigError({ CONDUIT_TEST_MEMORY: "true" }) ?? "", /NODE_ENV=test/);
  assert.match(persistenceConfigError({ NODE_ENV: "development", CONDUIT_TEST_MEMORY: "true" }) ?? "", /NODE_ENV=test/);
});
test("any non-empty value is refused outside test (no truthiness guessing)", () => {
  assert.ok(persistenceConfigError({ NODE_ENV: "production", CONDUIT_TEST_MEMORY: "false" }));
});
test("no switch is always allowed (Postgres optional)", () => {
  assert.equal(persistenceConfigError({ NODE_ENV: "production" }), null);
  assert.equal(persistenceConfigError({}), null);
});
test("NODE_ENV=test may use test memory", () => {
  assert.equal(persistenceConfigError({ NODE_ENV: "test", CONDUIT_TEST_MEMORY: "true" }), null);
});
