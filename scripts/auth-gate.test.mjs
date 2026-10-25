import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuthGate, summarizeAuthGate, runAuthGate } from "./auth-gate.mjs";

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
