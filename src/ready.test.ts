import test from "node:test";
import assert from "node:assert/strict";
import { checkReady, isReady, init } from "./store.js";

test("memory mode reports ready after init and checkReady succeeds", async () => {
  await init();
  assert.equal(isReady(), true);
  assert.equal(await checkReady(), true);
});
