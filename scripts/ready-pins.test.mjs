import test from "node:test";
import assert from "node:assert/strict";
import { READY_PINS, checkPins, probePin, probePins } from "./ready-pins.mjs";

const conduit = READY_PINS[0];
const good = { status: "ready", service: "conduit", version: "0.8.0", contractRevision: "x", persistence: "postgres", production: true };
const res = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const noSleep = async () => {};

test("checkPins: exact match passes; extra fields ignored", () => {
  assert.deepEqual(checkPins(conduit.pins, good), []);
});
test("checkPins: drift and absent fields fail closed", () => {
  const m = checkPins(conduit.pins, { ...good, persistence: "memory", production: undefined });
  assert.deepEqual(m.map((x) => x.field).sort(), ["persistence", "production"]);
  const { version: _v, ...noVersion } = good;
  assert.equal(checkPins(conduit.pins, noVersion)[0].actual, "absent");
});
test("checkPins: arrays compare exactly (missingRequired)", () => {
  const r = READY_PINS[1].pins;
  const body = { status: "ready", service: "resonance-nexus", production: true, authMode: "required", authModeOk: true, persistenceConfigured: true, posture: "contract_passed", missingRequired: ["X"] };
  assert.deepEqual(checkPins(r, body).map((x) => x.field), ["missingRequired"]);
});
test("checkPins: non-object bodies fail", () => {
  for (const b of [null, [], "ready", undefined]) assert.equal(checkPins(conduit.pins, b).length, 1);
});
test("probePin: retries cold-start 503 then passes", async () => {
  const seq = [res(503, ""), res(503, ""), res(200, good)];
  const r = await probePin(conduit, { fetchImpl: async () => seq.shift(), sleep: noSleep });
  assert.equal(r.ok, true);
});
test("probePin: persistent 503 after backoff is not ok", async () => {
  const r = await probePin(conduit, { fetchImpl: async () => res(503, ""), sleep: noSleep, backoffMs: [1, 1] });
  assert.equal(r.ok, false); assert.equal(r.reason, "http_503");
});
test("probePin: non-JSON, redirect and network errors fail closed", async () => {
  assert.equal((await probePin(conduit, { fetchImpl: async () => res(200, "<html>"), sleep: noSleep })).reason, "non_json");
  assert.equal((await probePin(conduit, { fetchImpl: async () => res(302, ""), sleep: noSleep })).reason, "http_302");
  assert.equal((await probePin(conduit, { fetchImpl: async () => { throw new Error("x"); }, sleep: noSleep, backoffMs: [] })).reason, "unreachable");
});
test("probePins: empty target list is not ok", async () => {
  assert.equal((await probePins([])).ok, false);
});
