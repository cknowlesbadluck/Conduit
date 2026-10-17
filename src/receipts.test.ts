import test from "node:test";
import assert from "node:assert/strict";
import { GENESIS_HASH, MemoryReceiptStore, ReceiptChain, bridgeReceipts, recordBridgeReceipt, redactDestination, resetBridgeReceiptsForTests, verifyReceiptChain } from "./receipts.js";

const fixedNow = () => new Date("2026-10-17T11:00:00.000Z");

test("receipts are HMAC-chained from genesis and verify", () => {
  const chain = new ReceiptChain("secret", new MemoryReceiptStore(), fixedNow);
  const a = chain.append({ endpoint: "https://mcp.example.com/mcp", method: "tools/list", grantId: "g1", decision: "allowed", status: 200 });
  const b = chain.append({ endpoint: "https://mcp.example.com/mcp", method: "tools/call", grantId: null, decision: "denied" });
  assert.equal(a.prevHash, GENESIS_HASH);
  assert.equal(b.prevHash, a.hash);
  assert.equal(b.seq, 2);
  assert.equal(b.status, null);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(verifyReceiptChain(chain.store.list(), "secret"), { ok: true, count: 2 });
});

test("tampering, reordering, a wrong secret and dropped records are detected", () => {
  const chain = new ReceiptChain("secret", new MemoryReceiptStore(), fixedNow);
  for (let i = 0; i < 3; i++) chain.append({ endpoint: "https://mcp.example.com/mcp", method: "ping", grantId: "g", decision: "allowed", status: 200 });
  const list = chain.store.list();
  assert.deepEqual(verifyReceiptChain([{ ...list[0], grantId: "forged" }, ...list.slice(1)], "secret"), { ok: false, count: 3, brokenAt: 0, reason: "bad_hash" });
  assert.equal(verifyReceiptChain([list[1], list[0], list[2]], "secret").ok, false);
  assert.equal(verifyReceiptChain(list, "wrong").ok, false);
  assert.deepEqual(verifyReceiptChain([list[0], list[2]], "secret"), { ok: false, count: 2, brokenAt: 1, reason: "bad_link" });
  assert.equal(verifyReceiptChain(list.slice(1), "secret").ok, false);
  assert.equal(verifyReceiptChain(list.slice(1), "secret", { partial: true }).ok, true);
});

test("destinations drop userinfo, query and token-like strings", () => {
  assert.equal(redactDestination("https://user:pass@mcp.example.com/mcp?token=abc&x=1"), "https://mcp.example.com/mcp");
  assert.equal(redactDestination("not a url"), "[invalid-url]");
  const chain = new ReceiptChain("secret", new MemoryReceiptStore(), fixedNow);
  const r = chain.append({ endpoint: "https://mcp.example.com/ghp_abcdefghijklmnopqrstuvwxyz0123", method: "tools/call", grantId: null, decision: "error" });
  assert.ok(!r.destination.includes("ghp_"));
});

test("ring buffer is bounded and the remaining window verifies as partial", () => {
  const chain = new ReceiptChain("secret", new MemoryReceiptStore(3), fixedNow);
  for (let i = 0; i < 5; i++) chain.append({ endpoint: "https://mcp.example.com/mcp", method: "ping", grantId: null, decision: "allowed", status: 200 });
  const list = chain.store.list();
  assert.deepEqual(list.map((r) => r.seq), [3, 4, 5]);
  assert.equal(verifyReceiptChain(list, "secret", { partial: true }).ok, true);
});

test("off unless CONDUIT_RECEIPT_SECRET is set; on, it logs a line the offline script verifies", () => {
  const saved = process.env.CONDUIT_RECEIPT_SECRET;
  const originalInfo = console.info;
  const lines: string[] = [];
  try {
    delete process.env.CONDUIT_RECEIPT_SECRET;
    resetBridgeReceiptsForTests();
    assert.equal(bridgeReceipts(), null);
    assert.equal(recordBridgeReceipt({ endpoint: "https://mcp.example.com/mcp", method: "ping", grantId: null, decision: "allowed", status: 200 }), null);

    process.env.CONDUIT_RECEIPT_SECRET = "s3cret-for-tests";
    resetBridgeReceiptsForTests();
    console.info = (line: string) => { lines.push(line); };
    recordBridgeReceipt({ endpoint: "https://mcp.example.com/mcp", method: "tools/list", grantId: "g1", decision: "allowed", status: 200 });
    recordBridgeReceipt({ endpoint: "https://mcp.example.com/mcp", method: "tools/call", grantId: null, decision: "denied" });
    assert.equal(lines.length, 2);
    assert.ok(!lines.join("\n").includes("s3cret-for-tests"));
    const receipts = lines.map((line) => JSON.parse(line)).map((entry) => { assert.equal(entry.type, "mcp.bridge.receipt"); return entry.receipt; });
    assert.deepEqual(verifyReceiptChain(receipts, "s3cret-for-tests"), { ok: true, count: 2 });
  } finally {
    console.info = originalInfo;
    if (saved === undefined) delete process.env.CONDUIT_RECEIPT_SECRET; else process.env.CONDUIT_RECEIPT_SECRET = saved;
    resetBridgeReceiptsForTests();
  }
});
