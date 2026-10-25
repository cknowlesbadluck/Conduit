import { test } from "node:test";
import assert from "node:assert/strict";
import { observe, probeAll, attachStartup } from "./portfolio-probe.mjs";

const res = (status, body) => ({ status, text: async () => body, headers: { get: () => null } });
const ready = JSON.stringify({ status: "ready", service: "conduit", contractRevision: "2026-10-03-ready-surface" });
const t = { name: "conduit", url: "https://x/ready", expectService: "conduit", expect: { contractRevision: "2026-10-03-ready-surface" } };
const noSleep = async () => {};

test("503 then 200 is annotated cold_start and stays ok", async () => {
  const seq = [res(503, "spinning"), res(200, ready)];
  const [r] = await probeAll([t], { fetchImpl: async () => seq.shift(), sleep: noSleep, random: () => 0 });
  assert.equal(r.startup, "cold_start");
  assert.equal(r.firstOkAttempt, 2);
  assert.equal(r.ok, true);
});
test("first-try 200 is ready", async () => {
  const [r] = await probeAll([t], { fetchImpl: async () => res(200, ready), sleep: noSleep });
  assert.equal(r.startup, "ready");
  assert.equal(r.attempts, 1);
});
test("two timeouts are down and not ok", async () => {
  const fetchImpl = async () => { const e = new Error("a"); e.name = "AbortError"; throw e; };
  const [r] = await probeAll([t], { fetchImpl, sleep: noSleep });
  assert.equal(r.startup, "down");
  assert.equal(r.ok, false);
});
test("observe logs attempts; attachStartup is a no-op without them and never flips ok", async () => {
  const o = await observe("https://x", { fetchImpl: async () => res(500, "boom"), sleep: noSleep });
  assert.deepEqual(o.attempts, [{ status: 500 }]);
  assert.deepEqual(attachStartup({}, { ok: true }), { ok: true });
  assert.equal(attachStartup(o, { ok: false }).startup, "error");
});
