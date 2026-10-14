import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isDevelopmentRuntime, isProductionRuntime } from "./runtime.js";

test("production runtime is detected from NODE_ENV, explicit flag, or hosting markers", () => {
  assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);
  assert.equal(isProductionRuntime({ CONDUIT_PRODUCTION: "true" }), true);
  for (const marker of ["RENDER", "FLY_APP_NAME", "RAILWAY_ENVIRONMENT", "VERCEL", "K_SERVICE"]) {
    assert.equal(isProductionRuntime({ [marker]: "x" }), true, marker);
  }
});

test("plain local development is not production", () => {
  assert.equal(isProductionRuntime({}), false);
  assert.equal(isProductionRuntime({ NODE_ENV: "development" }), false);
  assert.equal(isProductionRuntime({ RENDER: "  " }), false);
  assert.equal(isProductionRuntime({ CONDUIT_PRODUCTION: "false" }), false);
});

test("dev-only auth modes in index.ts are fenced by isDevelopmentRuntime", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /NODE_ENV/);
  assert.match(source, /CONDUIT_ALLOW_ANONYMOUS === "true" && isDevelopmentRuntime\(\)/);
  assert.equal(source.match(/process\.env\.CONDUIT_TOKEN && isDevelopmentRuntime\(\)/g)?.length, 2);
});

test("development modes require an explicit opt-in and no production signal (fail closed)", () => {
  assert.equal(isDevelopmentRuntime({}), false, "unidentified runtime is not development");
  assert.equal(isDevelopmentRuntime({ NODE_ENV: "staging" }), false);
  assert.equal(isDevelopmentRuntime({ CONDUIT_DEV_MODE: "true" }), true);
  assert.equal(isDevelopmentRuntime({ NODE_ENV: "development" }), true);
  assert.equal(isDevelopmentRuntime({ NODE_ENV: "test" }), true);
  assert.equal(isDevelopmentRuntime({ CONDUIT_DEV_MODE: "true", RENDER: "true" }), false);
  assert.equal(isDevelopmentRuntime({ NODE_ENV: "development", CONDUIT_PRODUCTION: "true" }), false);
});
