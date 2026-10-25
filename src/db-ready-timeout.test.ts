import test from "node:test";
import assert from "node:assert/strict";
import { raceWithTimeout } from "./db-ready.js";

test("raceWithTimeout resolves fast work and clears its timer", async () => {
  const before = (process as unknown as { getActiveResourcesInfo(): string[] }).getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  assert.equal(await raceWithTimeout(Promise.resolve(7), 60_000), 7);
  const after = (process as unknown as { getActiveResourcesInfo(): string[] }).getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  assert.ok(after <= before, `timer leaked: ${before} -> ${after}`);
});

test("raceWithTimeout rejects on timeout", async () => {
  await assert.rejects(raceWithTimeout(new Promise(() => {}), 10), /persistence_probe_timeout/);
});

test("raceWithTimeout propagates work rejection", async () => {
  await assert.rejects(raceWithTimeout(Promise.reject(new Error("boom")), 1000), /boom/);
});
