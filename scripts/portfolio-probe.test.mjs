import test from "node:test";
import assert from "node:assert/strict";
import { classify, observe, TARGETS } from "./portfolio-probe.mjs";

const conduit = { name: "conduit", url: "https://x/ready", expectService: "conduit" };
const resonance = { name: "resonance", url: "https://y/api/ready", expectService: "resonance-nexus" };

test("ready: matching service stamp + status ready", () => {
  const r = classify(conduit, { status: 200, body: JSON.stringify({ status: "ready", service: "conduit", version: "0.8.0", contractRevision: "2026-10-03-ready-surface", persistence: "postgres" }) });
  assert.equal(r.outcome, "ready"); assert.equal(r.ok, true); assert.equal(r.contractRevision, "2026-10-03-ready-surface");
});

test("not_ready: 503 with missing env names only", () => {
  const r = classify(resonance, { status: 503, body: JSON.stringify({ status: "not_ready", service: "resonance-nexus", missingRequired: ["SUPABASE_SERVICE_ROLE_KEY", "sk_live_SHOULD_NOT_ECHO lowercase", 42] }) });
  assert.equal(r.outcome, "not_ready"); assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["SUPABASE_SERVICE_ROLE_KEY"]);
});

test("stranger_occupant: 200 from someone else's app (HTML or wrong service)", () => {
  assert.equal(classify(resonance, { status: 200, body: "<html>hello</html>" }).outcome, "stranger_occupant");
  assert.equal(classify(resonance, { status: 200, body: JSON.stringify({ status: "ready", service: "other" }) }).outcome, "stranger_occupant");
  assert.equal(classify(resonance, { status: 200, body: "<html/>" }).ok, false);
});

test("alias_absent: Vercel DEPLOYMENT_NOT_FOUND via header or body", () => {
  assert.equal(classify(resonance, { status: 404, headers: { "x-vercel-error": "DEPLOYMENT_NOT_FOUND" }, body: "" }).outcome, "alias_absent");
  assert.equal(classify(resonance, { status: 404, body: "The deployment could not be found on Vercel.\n\nDEPLOYMENT_NOT_FOUND" }).outcome, "alias_absent");
});

test("timeout / unreachable / unknown all fail closed", () => {
  assert.deepEqual([classify(conduit, { error: "timeout" }).outcome, classify(conduit, { error: "unreachable" }).outcome], ["timeout", "unreachable"]);
  for (const obs of [undefined, { status: 500, body: "" }, { status: 404, body: "plain 404" }, { status: 200, body: JSON.stringify({ service: "conduit", status: "degraded" }) }, { status: 302, body: "" }]) {
    const r = classify(conduit, obs); assert.equal(r.ok, false); assert.equal(r.outcome, "unknown");
  }
});

test("observe sends no credentials, does not follow redirects, maps errors", async () => {
  let seen;
  const fake = async (_url, init) => { seen = init; return new Response('{"status":"ready"}', { status: 200 }); };
  const o = await observe("https://x/ready", { fetchImpl: fake });
  assert.equal(o.status, 200); assert.equal(seen.redirect, "manual");
  assert.equal(Object.keys(seen.headers).some((h) => /authorization|cookie/i.test(h)), false);
  assert.deepEqual(await observe("https://x", { fetchImpl: async () => { throw new TypeError("fetch failed"); } }), { error: "unreachable" });
  assert.deepEqual(await observe("https://x", { timeoutMs: 5, fetchImpl: (_u, init) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))) }), { error: "timeout" });
});

test("challenge: Cloudflare managed challenge is its own fail-closed outcome", () => {
  const html = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="https://challenges.cloudflare.com/x"></script></body></html>';
  for (const obs of [
    { status: 429, headers: { "cf-mitigated": "challenge", server: "cloudflare" }, body: html },
    { status: 403, headers: {}, body: html },
    { status: 200, headers: { "cf-mitigated": "challenge" }, body: "" },
  ]) { const r = classify(conduit, obs); assert.equal(r.outcome, "challenge"); assert.equal(r.ok, false); }
});

test("edge 503 with empty body from Cloudflare is unknown (origin unavailable), not ok", () => {
  const r = classify(conduit, { status: 503, headers: { server: "cloudflare" }, body: "" });
  assert.equal(r.outcome, "unknown"); assert.equal(r.reason, "edge_503_empty_origin_unavailable"); assert.equal(r.ok, false);
});

const pinnedConduit = { ...conduit, expect: { contractRevision: "2026-10-03-ready-surface" } };
const pinnedRes = { ...resonance, expect: { missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"] } };
const resBody = (missingRequired) => ({ status: 503, body: JSON.stringify({ status: "not_ready", service: "resonance-nexus", missingRequired }) });

test("drift: pinned contractRevision matches -> ready, no drift", () => {
  const r = classify(pinnedConduit, { status: 200, body: JSON.stringify({ status: "ready", service: "conduit", contractRevision: "2026-10-03-ready-surface" }) });
  assert.equal(r.outcome, "ready"); assert.equal(r.ok, true); assert.equal(r.drift, false);
});

test("drift: contractRevision changed or absent -> contract_changed, fail closed", () => {
  for (const extra of [{ contractRevision: "2026-11-01-new" }, {}]) {
    const r = classify(pinnedConduit, { status: 200, body: JSON.stringify({ status: "ready", service: "conduit", ...extra }) });
    assert.equal(r.outcome, "contract_changed"); assert.equal(r.ok, false); assert.equal(r.drift, true);
  }
});

test("drift: Resonance missing exactly the service role key is the known owner gate", () => {
  const r = classify(pinnedRes, resBody(["SUPABASE_SERVICE_ROLE_KEY"]));
  assert.equal(r.outcome, "not_ready"); assert.equal(r.ok, false); assert.equal(r.drift, false); assert.equal(r.reason, "known_owner_gate");
});

test("drift: any other missing set is a regression", () => {
  for (const m of [["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"], ["NEXT_PUBLIC_SUPABASE_URL"], [], ["SUPABASE_SERVICE_ROLE_KEY", "bad value"], "SUPABASE_SERVICE_ROLE_KEY"]) {
    const r = classify(pinnedRes, resBody(m));
    assert.equal(r.outcome, "regression", JSON.stringify(m)); assert.equal(r.ok, false); assert.equal(r.drift, true);
  }
});

test("drift: pinned gate cleared (ready) asks for pin update; unknown outcomes drift", () => {
  const ready = classify(pinnedRes, { status: 200, body: JSON.stringify({ status: "ready", service: "resonance-nexus" }) });
  assert.equal(ready.ok, true); assert.equal(ready.drift, true); assert.equal(ready.reason, "owner_gate_cleared_update_pin");
  for (const obs of [{ error: "timeout" }, { status: 500, body: "" }, { status: 200, body: "<html/>" }]) assert.equal(classify(pinnedRes, obs).drift, true);
});

test("drift: production targets pin the noon owner-probe values", () => {
  assert.equal(TARGETS.find((t) => t.name === "conduit").expect.contractRevision, "2026-10-03-ready-surface");
  assert.deepEqual(TARGETS.find((t) => t.name === "resonance-netlify").expect.missingRequired, ["SUPABASE_SERVICE_ROLE_KEY"]);
});
