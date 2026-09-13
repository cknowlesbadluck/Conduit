import test from "node:test";
import assert from "node:assert/strict";
import { init, isReady } from "./store.js";
import { checkPersistence } from "./db-ready.js";

test("memory mode reports ready after init and persistence check succeeds", async () => {
  await init();
  assert.equal(isReady(), true);
  assert.equal(await checkPersistence(), true);
});
