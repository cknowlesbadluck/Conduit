import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production startup does not expose static bearer-token MCP mode", async () => {
  const { conduitAppOptionsFromEnv } = await import("./app-factory.js");
  for (const env of [{ NODE_ENV: "production" }, { RENDER: "true", CONDUIT_DEV_MODE: "true" }, {}]) {
    const options = conduitAppOptionsFromEnv({ ...env, CONDUIT_TOKEN: "t", CONDUIT_ALLOW_ANONYMOUS: "true" }, null);
    assert.equal(options.devToken, undefined, JSON.stringify(env));
    assert.equal(options.anonymous, false, JSON.stringify(env));
  }
  const index = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(index, /createConduitApp\(conduitAppOptionsFromEnv\(process\.env, authConfig\)\)/);
});
