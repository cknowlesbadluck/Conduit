#!/usr/bin/env node
/**
 * Offline verifier for Conduit mcp_bridge_call receipts (see src/receipts.ts). Read-only, no network.
 *
 *   CONDUIT_RECEIPT_SECRET=... node scripts/verify-receipts.mjs receipts.jsonl [--partial] [--head=<chainId>:<seq>:<hash>]
 *
 * Input: JSON lines, each either a receipt object or a log line {"type":"mcp.bridge.receipt","receipt":{...}}.
 * Other lines are skipped. Receipts are grouped by chainId (one chain per process) and checked in seq order.
 * --partial accepts chains whose first record isn't seq 1 (a log window or an evicted ring buffer).
 * --head pins the expected last record of a chain (from ReceiptChain.head()) so tail truncation is detected.
 * The secret is read only from the environment and is never printed.
 * Exit 0 = every chain verifies, 1 = a chain is broken, 2 = usage error.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const GENESIS_HASH = "0".repeat(64);
export const RECEIPT_FIELDS = ["v", "chainId", "seq", "at", "prevHash", "destination", "method", "grantId", "decision", "status"];

export function sign(receipt, secret) {
  return createHmac("sha256", secret).update(JSON.stringify(RECEIPT_FIELDS.map((f) => receipt[f]))).digest("hex");
}

export function hashesEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !/^[0-9a-f]*$/.test(a) || !/^[0-9a-f]*$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function parseReceipts(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let value;
    try { value = JSON.parse(trimmed); } catch { continue; }
    const receipt = value?.type === "mcp.bridge.receipt" ? value.receipt : value;
    if (receipt && typeof receipt === "object" && typeof receipt.hash === "string" && typeof receipt.chainId === "string") out.push(receipt);
  }
  return out;
}

export function verifyChains(receipts, secret, { partial = false, heads = new Map() } = {}) {
  const chains = new Map();
  for (const r of receipts) { if (!chains.has(r.chainId)) chains.set(r.chainId, []); chains.get(r.chainId).push(r); }
  const results = [];
  for (const [chainId, list] of chains) {
    list.sort((a, b) => a.seq - b.seq);
    let failure = null;
    for (let i = 0; i < list.length && !failure; i++) {
      const r = list[i];
      if (!hashesEqual(sign(r, secret), r.hash)) failure = { brokenAt: r.seq, reason: "bad_hash" };
      else if (i === 0) { if (!partial && (!hashesEqual(r.prevHash, GENESIS_HASH) || r.seq !== 1)) failure = { brokenAt: r.seq, reason: "bad_genesis" }; }
      else if (r.seq !== list[i - 1].seq + 1) failure = { brokenAt: r.seq, reason: "gap_or_duplicate" };
      else if (!hashesEqual(r.prevHash, list[i - 1].hash)) failure = { brokenAt: r.seq, reason: "bad_link" };
    }
    const head = heads.get(chainId);
    const last = list[list.length - 1];
    if (!failure && head && (last.seq !== head.seq || !hashesEqual(last.hash, head.hash))) failure = { brokenAt: last.seq + 1, reason: "truncated" };
    results.push({ chainId, count: list.length, ok: !failure, ...(failure ?? {}) });
  }
  for (const [chainId] of heads) if (!chains.has(chainId)) results.push({ chainId, count: 0, ok: false, brokenAt: 1, reason: "truncated" });
  return { ok: results.every((r) => r.ok), chains: results };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const secret = process.env.CONDUIT_RECEIPT_SECRET;
  if (!file || !secret) {
    console.error("usage: CONDUIT_RECEIPT_SECRET=... node scripts/verify-receipts.mjs <receipts.jsonl> [--partial]");
    process.exit(2);
  }
  const heads = new Map();
  for (const a of args.filter((x) => x.startsWith("--head="))) {
    const [chainId, seq, hash] = a.slice(7).split(":");
    if (!chainId || !/^\d+$/.test(seq ?? "") || !/^[0-9a-f]{64}$/.test(hash ?? "")) { console.error("bad --head, expected <chainId>:<seq>:<64-hex hash>"); process.exit(2); }
    heads.set(chainId, { seq: Number(seq), hash });
  }
  const result = verifyChains(parseReceipts(await readFile(file, "utf8")), secret, { partial: args.includes("--partial"), heads });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
