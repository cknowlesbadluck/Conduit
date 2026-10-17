import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { redactString } from "./redact.js";
import { capabilitiesRequired, matchesCapability, type CapabilityProvider } from "./capabilities.js";
import { getCapabilityGrantsForAgent } from "./capability-store.js";

/**
 * Signed grant receipts for mcp_bridge_call (opt-in).
 *
 * Off unless CONDUIT_RECEIPT_SECRET is set. Each bridge call appends one receipt whose `hash` is
 * HMAC-SHA256(secret, canonical(receipt without hash)) and whose `prevHash` is the previous receipt's
 * hash, so editing, dropping or reordering any record breaks the chain. Receipts carry no request
 * params or response bodies: only the redacted destination (origin + path, never query or userinfo),
 * the JSON-RPC method, the matched grant id, the decision and a timestamp.
 *
 * Storage sits behind ReceiptStore. The default is a bounded in-memory ring buffer
 * (CONDUIT_RECEIPT_RING, default 1000). Every receipt is also written as one JSON log line
 * (type "mcp.bridge.receipt"), so a log export can be checked offline with scripts/verify-receipts.mjs.
 * No schema or migration.
 */

export const GENESIS_HASH = "0".repeat(64);
export type ReceiptDecision = "allowed" | "denied" | "error";

export type Receipt = {
  v: 1;
  chainId: string;
  seq: number;
  at: string;
  prevHash: string;
  destination: string;
  method: string;
  grantId: string | null;
  decision: ReceiptDecision;
  status: number | null;
  hash: string;
};

export type ReceiptInput = { endpoint: string; method: string; grantId: string | null; decision: ReceiptDecision; status?: number | null };

/** Field order is part of the format: verify-receipts.mjs uses the same list. */
export const RECEIPT_FIELDS = ["v", "chainId", "seq", "at", "prevHash", "destination", "method", "grantId", "decision", "status"] as const;

export function canonicalReceipt(receipt: Omit<Receipt, "hash">): string {
  return JSON.stringify(RECEIPT_FIELDS.map((field) => receipt[field]));
}

export function signReceipt(receipt: Omit<Receipt, "hash">, secret: string): string {
  return createHmac("sha256", secret).update(canonicalReceipt(receipt)).digest("hex");
}

/** Constant-time comparison of two hex digests (length mismatch returns false without early exit on content). */
export function hashesEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !/^[0-9a-f]*$/.test(a) || !/^[0-9a-f]*$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Origin + pathname only; userinfo and query are dropped, then the generic redactor runs. Never throws. */
export function redactDestination(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return redactString(`${url.protocol}//${url.host}${url.pathname}`).slice(0, 500);
  } catch {
    return "[invalid-url]";
  }
}

export interface ReceiptStore {
  append(receipt: Receipt): void;
  list(): Receipt[];
}

export class MemoryReceiptStore implements ReceiptStore {
  private readonly items: Receipt[] = [];
  constructor(private readonly capacity = 1000) {}
  append(receipt: Receipt): void {
    this.items.push(receipt);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  list(): Receipt[] { return [...this.items]; }
}

export class ReceiptChain {
  readonly chainId = randomUUID();
  private seq = 0;
  private prevHash = GENESIS_HASH;
  /** ES private field: not enumerable, so JSON.stringify / util.inspect / structured logs of the chain never include it. */
  readonly #secret: string;
  constructor(secret: string, readonly store: ReceiptStore, private readonly now: () => Date = () => new Date()) {
    if (!secret) throw new Error("receipt_secret_required");
    this.#secret = secret;
  }
  /**
   * The latest (seq, hash). Safe to publish (an HMAC output reveals nothing about the secret); pass it to
   * verifyReceiptChain({ head }) / verify-receipts.mjs --head to detect tail truncation, which a hash
   * chain alone cannot see.
   */
  head(): { chainId: string; seq: number; hash: string } { return { chainId: this.chainId, seq: this.seq, hash: this.prevHash }; }
  /** Synchronous so concurrent calls in one process always chain in a single order. */
  append(input: ReceiptInput): Receipt {
    const unsigned: Omit<Receipt, "hash"> = {
      v: 1,
      chainId: this.chainId,
      seq: ++this.seq,
      at: this.now().toISOString(),
      prevHash: this.prevHash,
      destination: redactDestination(input.endpoint),
      method: redactString(input.method).slice(0, 200),
      grantId: input.grantId,
      decision: input.decision,
      status: input.status ?? null,
    };
    const receipt: Receipt = { ...unsigned, hash: signReceipt(unsigned, this.#secret) };
    this.prevHash = receipt.hash;
    this.store.append(receipt);
    return receipt;
  }
}

export type ChainVerdict = { ok: true; count: number } | { ok: false; count: number; brokenAt: number; reason: "bad_hash" | "bad_link" | "bad_seq" | "bad_genesis" | "truncated" };

/**
 * Verify one chain's receipts (in seq order). `partial` accepts a window that starts mid-chain
 * (for example after the ring buffer evicted older entries): the first record's link is not checked.
 */
export function verifyReceiptChain(receipts: Receipt[], secret: string, options: { partial?: boolean; head?: { seq: number; hash: string } } = {}): ChainVerdict {
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const { hash, ...unsigned } = r;
    if (!hashesEqual(signReceipt(unsigned, secret), hash)) return { ok: false, count: receipts.length, brokenAt: i, reason: "bad_hash" };
    if (i === 0) {
      if (!options.partial && (!hashesEqual(r.prevHash, GENESIS_HASH) || r.seq !== 1)) return { ok: false, count: receipts.length, brokenAt: 0, reason: "bad_genesis" };
      continue;
    }
    if (!hashesEqual(r.prevHash, receipts[i - 1].hash)) return { ok: false, count: receipts.length, brokenAt: i, reason: "bad_link" };
    if (r.seq !== receipts[i - 1].seq + 1 || r.chainId !== receipts[i - 1].chainId) return { ok: false, count: receipts.length, brokenAt: i, reason: "bad_seq" };
  }
  if (options.head) {
    const last = receipts[receipts.length - 1];
    if (!last || last.seq !== options.head.seq || !hashesEqual(last.hash, options.head.hash)) return { ok: false, count: receipts.length, brokenAt: receipts.length, reason: "truncated" };
  }
  return { ok: true, count: receipts.length };
}

let processChain: ReceiptChain | null | undefined;

/** The process-wide chain, or null when CONDUIT_RECEIPT_SECRET is unset (feature off). */
export function bridgeReceipts(): ReceiptChain | null {
  if (processChain !== undefined) return processChain;
  const secret = process.env.CONDUIT_RECEIPT_SECRET;
  if (!secret) return (processChain = null);
  const ring = Number(process.env.CONDUIT_RECEIPT_RING);
  const capacity = Number.isFinite(ring) && ring >= 1 ? Math.min(100_000, Math.floor(ring)) : 1000;
  return (processChain = new ReceiptChain(secret, new MemoryReceiptStore(capacity)));
}

/** Test hook: forget the cached chain so the next call re-reads the environment. */
export function resetBridgeReceiptsForTests(): void { processChain = undefined; }

/** Append and log one receipt. Never throws: a receipt failure must not change the bridge result. */
export function recordBridgeReceipt(input: ReceiptInput): Receipt | null {
  try {
    const chain = bridgeReceipts();
    if (!chain) return null;
    const receipt = chain.append(input);
    console.info(JSON.stringify({ type: "mcp.bridge.receipt", receipt }));
    return receipt;
  } catch {
    return null;
  }
}

/** The id of the grant that authorized this call, looked up only when receipts are on and grants are enforced. */
export async function matchedGrantId(request: { agentId?: string; provider: CapabilityProvider; method: string; path: string; projectId?: string }): Promise<string | null> {
  if (!bridgeReceipts() || !capabilitiesRequired() || !request.agentId) return null;
  try {
    const grants = await getCapabilityGrantsForAgent(request.agentId, request.projectId);
    return grants.find((grant) => matchesCapability(grant, { ...request, agentId: request.agentId! }))?.id ?? null;
  } catch {
    return null;
  }
}
