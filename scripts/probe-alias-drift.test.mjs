import test from "node:test";
import assert from "node:assert/strict";
import { aliasDrift, isResonanceAlias, classify, attachParity, RESONANCE_MAIN_READY, TARGETS } from "./portfolio-probe.mjs";

const alias = { name: "resonance-vercel", url: "https://resonance.vercel.app/api/ready", expectService: "resonance-nexus" };
const pinned = { ...alias, parity: RESONANCE_MAIN_READY };
const run = (obs) => attachParity(pinned, obs, classify(alias, obs));
const fullBody = JSON.stringify(Object.fromEntries(RESONANCE_MAIN_READY.fields.map((f) => [f, f === "status" ? "ready" : f === "service" ? "resonance-nexus" : f === "contractRevision" ? RESONANCE_MAIN_READY.contractRevision : f === "missingRequired" ? [] : null])));

test("only Resonance vercel.app targets are aliases", () => {
  assert.deepEqual(TARGETS.filter(isResonanceAlias).map((t) => t.name), ["resonance-vercel", "resonancenexus-vercel"]);
  assert.equal(isResonanceAlias({ name: "resonance-x", url: "not a url" }), false);
});

test("third-party HTML on the alias is flagged as drift", () => {
  const r = run({ status: 200, headers: {}, body: "<!DOCTYPE html><title>Detail Framework</title>" });
  const d = aliasDrift([r], [alias]);
  assert.equal(d.ok, false);
  assert.deepEqual(d.drifted, ["resonance-vercel"]);
  assert.equal(d.aliases[0].reason, "stranger_occupant");
});

test("full ready contract counts as Resonance", () => {
  const d = aliasDrift([run({ status: 200, headers: {}, body: fullBody })], [alias]);
  assert.equal(d.ok, true);
  assert.equal(d.aliases[0].verdict, "resonance");
});

test("ready stamp without the contract fields fails closed", () => {
  const d = aliasDrift([run({ status: 200, headers: {}, body: JSON.stringify({ status: "ready", service: "resonance-nexus" }) })], [alias]);
  assert.equal(d.ok, false);
  assert.equal(d.aliases[0].reason, "ready_contract_incomplete");
});

test("timeout, absent alias and unprobed alias all fail closed", () => {
  assert.equal(aliasDrift([run({ error: "timeout" })], [alias]).ok, false);
  assert.equal(aliasDrift([run({ status: 404, headers: { "x-vercel-error": "DEPLOYMENT_NOT_FOUND" }, body: "" })], [alias]).aliases[0].reason, "alias_absent");
  assert.equal(aliasDrift([], [alias]).aliases[0].reason, "not_probed");
});

test("full-contract 503 not_ready still counts as Resonance (identity is not readiness)", () => {
  const body = JSON.parse(fullBody); body.status = "not_ready"; body.missingRequired = ["SOME_OWNER_KEY"];
  const r = run({ status: 503, headers: {}, body: JSON.stringify(body) });
  assert.equal(r.ok, false);
  const d = aliasDrift([r], [alias]);
  assert.equal(d.ok, true);
  assert.equal(d.aliases[0].reason, "ready_contract_present");
});

test("a weaker per-target parity pin cannot produce a false Resonance verdict", () => {
  const weak = { ...alias, parity: { fields: ["status", "service"], contractRevision: RESONANCE_MAIN_READY.contractRevision } };
  const obs = { status: 200, headers: {}, body: JSON.stringify({ status: "ready", service: "resonance-nexus" }) };
  const r = attachParity(weak, obs, classify(alias, obs));
  assert.deepEqual(r.missingContractFields, []);
  const d = aliasDrift([r], [alias]);
  assert.equal(d.ok, false);
  assert.equal(d.aliases[0].reason, "ready_contract_incomplete");
});

test("complete body from a different service is not Resonance (service checked independently)", () => {
  const other = { ...alias, expectService: "conduit" };
  const body = JSON.stringify({ ...JSON.parse(fullBody), service: "conduit" });
  const obs = { status: 200, headers: {}, body };
  const r = attachParity({ ...other, parity: RESONANCE_MAIN_READY }, obs, classify(other, obs));
  assert.equal(r.outcome, "ready");
  const d = aliasDrift([r], [other]);
  assert.equal(d.ok, false);
  assert.equal(d.aliases[0].reason, "service_mismatch");
});
