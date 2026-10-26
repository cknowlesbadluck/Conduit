import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuthGate, summarizeAuthGate, runAuthGate, checkBearerChallenge } from "./auth-gate.mjs";

test("401/403 are gated; everything else is not", () => {
  assert.equal(classifyAuthGate(401).gated, true);
  assert.equal(classifyAuthGate(403).gated, true);
  assert.deepEqual(classifyAuthGate(200), { gated: false, reason: "open_without_auth" });
  assert.equal(classifyAuthGate(404).reason, "unexpected_status_404");
  assert.equal(classifyAuthGate(500).gated, false);
  assert.equal(classifyAuthGate(undefined).reason, "unreachable");
});

test("summary fails closed on empty input and on any open surface", () => {
  assert.equal(summarizeAuthGate([]).ok, false);
  assert.equal(summarizeAuthGate([{ name: "a", gated: true }]).ok, true);
  assert.deepEqual(summarizeAuthGate([{ name: "a", gated: true }, { name: "b", gated: false }]).open, ["b"]);
});

test("runAuthGate uses injected fetch, sends no auth header, treats errors as unreachable", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers ?? {}); if (url.includes("bad")) throw new Error("net"); return { status: url.includes("open") ? 200 : 401 }; };
  const r = await runAuthGate([{ name: "g", method: "GET", url: "https://x/gated" }, { name: "o", method: "GET", url: "https://x/open" }, { name: "b", method: "GET", url: "https://x/bad" }], { fetchImpl });
  assert.equal(r.ok, false);
  assert.deepEqual(r.open, ["o", "b"]);
  assert.equal(r.checks[2].reason, "unreachable");
  for (const h of seen) assert.ok(!Object.keys(h).some((k) => k.toLowerCase() === "authorization"));
});

test("checkBearerChallenge: accepts RFC 9728 Bearer challenge with https metadata", () => {
  assert.equal(checkBearerChallenge('Bearer error="invalid_token", resource_metadata="https://h/.well-known/oauth-protected-resource/mcp"').ok, true);
});
test("checkBearerChallenge: fails closed on missing/malformed/insecure", () => {
  assert.equal(checkBearerChallenge(undefined).reason, "missing_bearer_challenge");
  assert.equal(checkBearerChallenge("Basic realm=x").reason, "missing_bearer_challenge");
  assert.equal(checkBearerChallenge("Bearer").reason, "missing_resource_metadata");
  assert.equal(checkBearerChallenge('Bearer resource_metadata="::"').reason, "invalid_resource_metadata");
  assert.equal(checkBearerChallenge('Bearer resource_metadata="http://h/x"').reason, "insecure_resource_metadata");
});
test("runAuthGate: bare 401 on a challenge-required target is not gated", async () => {
  const fetchImpl = async () => ({ status: 401, headers: new Headers() });
  const r = await runAuthGate([{ name: "m", method: "POST", url: "https://x", requireBearerChallenge: true }], { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.checks[0].reason, "missing_bearer_challenge");
});
test("runAuthGate: 401 with valid challenge is gated; 403 needs no challenge", async () => {
  const ok = await runAuthGate([{ name: "m", method: "POST", url: "https://x", requireBearerChallenge: true }], { fetchImpl: async () => ({ status: 401, headers: new Headers({ "www-authenticate": 'Bearer resource_metadata="https://x/m"' }) }) });
  assert.equal(ok.ok, true);
  const forbid = await runAuthGate([{ name: "m", method: "POST", url: "https://x", requireBearerChallenge: true }], { fetchImpl: async () => ({ status: 403, headers: new Headers() }) });
  assert.equal(forbid.ok, true);
});
