import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isProductionRuntime } from "./runtime.js";

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

test("dev-only auth modes in index.ts are fenced by isProductionRuntime", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /NODE_ENV/);
  assert.match(source, /CONDUIT_ALLOW_ANONYMOUS === "true" && !isProductionRuntime\(\)/);
  assert.equal(source.match(/process\.env\.CONDUIT_TOKEN && !isProductionRuntime\(\)/g)?.length, 2);
});
