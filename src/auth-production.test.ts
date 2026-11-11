import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production startup does not expose static bearer-token MCP mode", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /function developmentAuthAllowed\(\)/);
  assert.match(source, /return !isHostedProduction\(\)/);
  assert.match(source, /CONDUIT_TOKEN && developmentAuthAllowed\(\)/);
  assert.doesNotMatch(source, /CONDUIT_ALLOW_ANONYMOUS === "true" && process\.env\.NODE_ENV/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /auth_not_configured/);
});
