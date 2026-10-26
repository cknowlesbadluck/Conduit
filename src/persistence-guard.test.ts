import test from "node:test";
import assert from "node:assert/strict";
import { assertPersistenceConfig, persistenceConfigError } from "./persistence-guard.js";

test("production + CONDUIT_TEST_MEMORY=true refuses to boot", () => {
  assert.throws(() => assertPersistenceConfig({ NODE_ENV: "production", CONDUIT_TEST_MEMORY: "true", DATABASE_URL: "postgres://x" }), /test-only/);
});
test("any non-empty CONDUIT_TEST_MEMORY value in production is refused (no truthiness guessing)", () => {
  assert.match(persistenceConfigError({ NODE_ENV: "production", CONDUIT_TEST_MEMORY: "1" }) ?? "", /test-only/);
  assert.match(persistenceConfigError({ NODE_ENV: "production", CONDUIT_TEST_MEMORY: "false" }) ?? "", /test-only/);
});
test("production without DATABASE_URL is still allowed (Postgres optional)", () => {
  assert.equal(persistenceConfigError({ NODE_ENV: "production" }), null);
});
test("non-production may use test memory", () => {
  assert.equal(persistenceConfigError({ NODE_ENV: "test", CONDUIT_TEST_MEMORY: "true" }), null);
  assert.equal(persistenceConfigError({ CONDUIT_TEST_MEMORY: "true" }), null);
});
