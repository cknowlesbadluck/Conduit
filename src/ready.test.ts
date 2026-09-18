import test from "node:test";
import assert from "node:assert/strict";
import { init, isReady } from "./store.js";
import { checkPersistence } from "./db-ready.js";

test("memory mode reports ready after init and persistence check succeeds", async () => {
  await init();
  assert.equal(isReady(), true);
  assert.equal(await checkPersistence(), true);
});

test("checkPersistence stays true when DATABASE_URL is unset", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.equal(await checkPersistence(), true);
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  }
});
