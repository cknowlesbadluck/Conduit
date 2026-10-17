import test from "node:test";
import assert from "node:assert/strict";
import { parseReceipts, sign, verifyChains, hashesEqual, GENESIS_HASH } from "./verify-receipts.mjs";
import { MemoryReceiptStore, ReceiptChain } from "../dist/receipts.js";

function chain(secret, n, chainId = "c1") {
  const out = []; let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const r = { v: 1, chainId, seq, at: `2026-10-17T11:00:0${seq}.000Z`, prevHash: prev, destination: "https://mcp.example.com/mcp", method: "tools/list", grantId: "g1", decision: "allowed", status: 200 };
    r.hash = sign(r, secret); prev = r.hash; out.push(r);
  }
  return out;
}

test("verifies log-line and bare receipts, grouped per chain", () => {
  const a = chain("s", 3, "a"); const b = chain("s", 2, "b");
  const text = [JSON.stringify({ type: "mcp.bridge.receipt", receipt: a[0] }), "noise", JSON.stringify(b[0]), JSON.stringify(a[2]), JSON.stringify(a[1]), JSON.stringify(b[1])].join("\n");
  const result = verifyChains(parseReceipts(text), "s");
  assert.equal(result.ok, true);
  assert.deepEqual(result.chains.map((c) => c.count).sort(), [2, 3]);
});

test("detects tampering, deletion, wrong secret, and windows without --partial", () => {
  const c = chain("s", 4);
  assert.equal(verifyChains([{ ...c[0], decision: "denied" }, ...c.slice(1)], "s").chains[0].reason, "bad_hash");
  assert.equal(verifyChains([c[0], c[2], c[3]], "s").chains[0].reason, "gap_or_duplicate");
  assert.equal(verifyChains(c, "other").ok, false);
  assert.equal(verifyChains(c.slice(2), "s").chains[0].reason, "bad_genesis");
  assert.equal(verifyChains(c.slice(2), "s", { partial: true }).ok, true);
});

test("the offline verifier accepts what the server signs (dist/receipts.js)", () => {
  const server = new ReceiptChain("shared", new MemoryReceiptStore());
  server.append({ endpoint: "https://mcp.example.com/mcp", method: "tools/list", grantId: "g1", decision: "allowed", status: 200 });
  server.append({ endpoint: "https://mcp.example.com/mcp", method: "tools/call", grantId: null, decision: "denied" });
  const text = server.store.list().map((receipt) => JSON.stringify({ type: "mcp.bridge.receipt", receipt })).join("\n");
  assert.equal(verifyChains(parseReceipts(text), "shared").ok, true);
  assert.equal(verifyChains(parseReceipts(text), "not-shared").ok, false);
});

test("--head pins the last record: truncated tails and missing chains fail; constant-time compare is strict", () => {
  const a = chain("s", 4, "a");
  const heads = new Map([["a", { seq: 4, hash: a[3].hash }]]);
  assert.equal(verifyChains(a, "s", { heads }).ok, true);
  const cut = verifyChains(a.slice(0, 3), "s", { heads });
  assert.equal(cut.ok, false);
  assert.equal(cut.chains[0].reason, "truncated");
  const gone = verifyChains([], "s", { heads });
  assert.equal(gone.ok, false);
  assert.equal(gone.chains[0].reason, "truncated");
  assert.equal(hashesEqual(a[0].hash, a[0].hash), true);
  assert.equal(hashesEqual(a[0].hash, a[1].hash), false);
  assert.equal(hashesEqual(a[0].hash, a[0].hash.slice(2)), false);
});
