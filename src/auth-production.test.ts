import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production startup does not expose static bearer-token MCP mode", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.CONDUIT_TOKEN && process\.env\.NODE_ENV !== \"production\"/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /auth_not_configured/);
});
