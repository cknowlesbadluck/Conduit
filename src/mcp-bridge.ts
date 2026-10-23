import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { MCP_PROTOCOL_VERSION, SERVICE_NAME, VERSION } from "./version.js";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * Total wall-clock budget for one bridge call (connect + headers + body). REQUEST_TIMEOUT_MS on
 * https.request is only a socket *idle* timeout, so a peer that drips one byte every few seconds could
 * otherwise hold the call open far longer. The deadline bounds it regardless of transport.
 */
const REQUEST_DEADLINE_MS = 20_000;
let requestDeadlineMs = REQUEST_DEADLINE_MS;

type McpBridgeRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };
type McpBridgeResult = { ok: boolean; status: number; headers: Record<string, string>; data: unknown };
type AddressRecord = { address: string; family: number };
type AddressLookup = (hostname: string) => Promise<AddressRecord[]>;
/** `signal` aborts when the caller's total deadline fires (the transport must destroy its socket); `deadlineMs` is the remaining budget. */
type BridgeTransport = (url: URL, init: { body: string; headers: Record<string, string>; addresses: AddressRecord[]; signal?: AbortSignal; deadlineMs?: number }) => Promise<Response>;

let addressLookup: AddressLookup = (hostname) => dnsLookup(hostname, { all: true });
let bridgeTransport: BridgeTransport = pinnedHttpsTransport;

/** Test hook. Do not use in production paths. */
export function setMcpBridgeLookupForTests(fn?: AddressLookup) {
  addressLookup = fn ?? ((hostname) => dnsLookup(hostname, { all: true }));
}

/** Test hook. Do not use in production paths. */
export function setMcpBridgeDeadlineForTests(ms?: number) {
  requestDeadlineMs = ms ?? REQUEST_DEADLINE_MS;
}

function timeoutError(): Error {
  return Object.assign(new Error("TimeoutError"), { name: "TimeoutError" });
}

/** Reject with a TimeoutError once `ms` elapses; `onTimeout` lets the caller tear down the underlying request. */
function withDeadline<T>(work: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(timeoutError()); }, ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export function setMcpBridgeTransportForTests(fn?: BridgeTransport) {
  bridgeTransport = fn ?? pinnedHttpsTransport;
}

function parseIpv4Octets(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

// Performance Optimization: Direct character-code extraction of IPv4 octets in a single pass.
// Avoids string splitting (.split(".")) and array allocations (.map, .some) on every SSRF address check.
function isDisallowedIpv4(value: string): boolean {
  let a = 0, b = 0;
  let count = 0, cur = 0, digits = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      cur = cur * 10 + (code - 48);
      digits++;
      if (cur > 255 || digits > 3) return true;
    } else if (code === 46) {
      if (digits === 0) return true;
      if (count === 0) a = cur;
      else if (count === 1) b = cur;
      else if (count >= 3) return true;
      count++;
      cur = 0;
      digits = 0;
    } else {
      return true;
    }
  }
  if (count !== 3 || digits === 0) return true;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function expandIpv6(value: string): number[] | null {
  const lower = value.toLowerCase();
  if (lower.includes(".")) {
    const lastColon = lower.lastIndexOf(":");
    const ipv4 = parseIpv4Octets(lower.slice(lastColon + 1));
    if (!ipv4) return null;
    const head = lower.slice(0, lastColon);
    const embedded = `${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
    return expandIpv6(`${head}:${embedded}`);
  }
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => (half ? half.split(":").map((hextet) => Number.parseInt(hextet, 16)) : []);
  const left = parseHalf(halves[0]);
  const right = halves.length === 2 ? parseHalf(halves[1]) : [];
  if ([...left, ...right].some((hextet) => !Number.isInteger(hextet) || hextet < 0 || hextet > 0xffff)) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function hextetsToIpv4(high: number, low: number): string {
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

export function isDisallowedAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(value) === 4) return isDisallowedIpv4(value);
  if (isIP(value) === 6) {
    const hextets = expandIpv6(value);
    if (!hextets) return true;
    if (hextets.every((hextet) => hextet === 0)) return true; // ::
    if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    // IPv4-mapped ::ffff:x.x.x.x
    if (hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0xffff) {
      return isDisallowedIpv4(hextetsToIpv4(hextets[6], hextets[7]));
    }
    // Deprecated IPv4-compatible ::x.x.x.x (includes ::1 / ::127.0.0.1)
    if (hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0) {
      return isDisallowedIpv4(hextetsToIpv4(hextets[6], hextets[7]));
    }
    if (hextets[0] === 0x2002) return isDisallowedIpv4(hextetsToIpv4(hextets[1], hextets[2])); // 6to4
    if (hextets[0] === 0x64 && hextets[1] === 0xff9b && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0) {
      return isDisallowedIpv4(hextetsToIpv4(hextets[6], hextets[7])); // NAT64 well-known prefix
    }
    if ((hextets[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
    if (hextets[0] === 0x2001 && hextets[1] === 0) return true; // Teredo 2001::/32
    if (hextets[0] === 0x2001 && hextets[1] === 0xdb8) return true; // documentation 2001:db8::/32
    return false;
  }
  return false;
}

export function pinnedLookup(hostname: string, addresses: AddressRecord[]): AddressLookup {
  return async (requested) => {
    if (requested !== hostname) throw new Error("mcp_endpoint_host_mismatch");
    return addresses;
  };
}

async function validateEndpoint(endpoint: string): Promise<{ url: URL; addresses: AddressRecord[] }> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("mcp_endpoint_invalid"); }
  if (url.protocol !== "https:") throw new Error("mcp_endpoint_must_be_https");
  if (url.username || url.password) throw new Error("mcp_endpoint_invalid");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host === "metadata.google.internal" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("mcp_endpoint_local_target");
  }

  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (isDisallowedAddress(literal)) throw new Error("mcp_endpoint_local_target");
    return { url, addresses: [{ address: literal, family: isIP(literal) }] };
  }

  let records: AddressRecord[];
  try {
    records = await addressLookup(host);
  } catch {
    throw new Error("mcp_endpoint_unresolvable");
  }
  if (!records.length) throw new Error("mcp_endpoint_unresolvable");
  for (const record of records) {
    if (isDisallowedAddress(record.address)) throw new Error("mcp_endpoint_local_target");
  }
  return { url, addresses: records };
}

function pinnedHttpsTransport(url: URL, init: { body: string; headers: Record<string, string>; addresses: AddressRecord[]; signal?: AbortSignal; deadlineMs?: number }): Promise<Response> {
  const { addresses, body, headers, signal } = init;
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: "https:",
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers,
      servername: url.hostname,
      timeout: REQUEST_TIMEOUT_MS,
      lookup(hostname, options, callback) {
        if (hostname !== url.hostname) {
          const error = Object.assign(new Error("mcp_endpoint_host_mismatch"), { code: "ENOTFOUND" }) as NodeJS.ErrnoException;
          callback(error, "");
          return;
        }
        if (options.all) {
          callback(null, addresses.map((record) => ({ address: record.address, family: record.family === 6 ? 6 : 4 })));
          return;
        }
        const first = addresses[0];
        callback(null, first.address, first.family === 6 ? 6 : 4);
      },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let overflow = false;
      incoming.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          overflow = true;
          incoming.destroy();
          reject(new Error("mcp_response_too_large"));
          return;
        }
        chunks.push(buf);
      });
      incoming.on("end", () => {
        if (overflow) return;
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (typeof value === "string") responseHeaders.set(key, value);
          else if (Array.isArray(value)) responseHeaders.set(key, value.join(", "));
        }
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 0, headers: responseHeaders }));
      });
      incoming.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(timeoutError());
    });
    const totalDeadline = setTimeout(() => { req.destroy(); reject(timeoutError()); }, init.deadlineMs ?? requestDeadlineMs);
    // The caller's deadline covers DNS + connect + TLS + body; when it fires, release the socket immediately.
    const onAbort = () => { req.destroy(); reject(timeoutError()); };
    if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal?.removeEventListener("abort", onAbort));
    totalDeadline.unref?.();
    req.on("close", () => clearTimeout(totalDeadline));
    req.on("error", reject);
    req.end(body);
  });
}

async function readLimited(response: Response, signal?: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("mcp_response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  // The reader holds the stream lock, so cancellation at the deadline has to go through it.
  signal?.addEventListener("abort", () => { void reader.cancel().catch(() => undefined); }, { once: true });
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("mcp_response_too_large"); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function callMcpBridge(input: { endpoint: string; request: McpBridgeRequest }): Promise<McpBridgeResult> {
  // One budget for the whole call: DNS resolution (validateEndpoint), connect/TLS, headers and body.
  const startedAt = Date.now();
  const remaining = (): number => Math.max(1, requestDeadlineMs - (Date.now() - startedAt));
  let url: URL; let addresses: AddressRecord[];
  try {
    ({ url, addresses } = await withDeadline(validateEndpoint(input.endpoint), requestDeadlineMs));
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    throw error;
  }
  let body: string;
  try { body = JSON.stringify(input.request); } catch { throw new Error("mcp_request_invalid_json"); }
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) throw new Error("mcp_request_too_large");
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "User-Agent": `${SERVICE_NAME}/${VERSION}`,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  let response: Response;
  try {
    const transportAbort = new AbortController();
    const budget = remaining();
    response = await withDeadline(bridgeTransport(url, { body, headers, addresses, signal: transportAbort.signal, deadlineMs: budget }), budget, () => transportAbort.abort());
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    if (error instanceof Error && error.message === "mcp_response_too_large") throw error;
    throw new Error("mcp_bridge_network_failed");
  }
  let text: string;
  try {
    // The body read shares the same total budget, and a stalled body is cancelled at the deadline.
    const bodyAbort = new AbortController();
    text = await withDeadline(readLimited(response, bodyAbort.signal), remaining(), () => bodyAbort.abort());
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    throw error;
  }
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    if (["content-type", "mcp-session-id", "www-authenticate", "retry-after"].includes(key.toLowerCase())) responseHeaders[key] = value;
  }
  return { ok: response.ok, status: response.status, headers: responseHeaders, data };
}
