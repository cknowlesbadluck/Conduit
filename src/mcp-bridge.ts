import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { MCP_PROTOCOL_VERSION, SERVICE_NAME, VERSION } from "./version.js";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type McpBridgeRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };
export type McpBridgeResult = { ok: boolean; status: number; headers: Record<string, string>; data: unknown };
export type AddressRecord = { address: string; family: number };
export type AddressLookup = (hostname: string) => Promise<AddressRecord[]>;
export type BridgeTransport = (url: URL, init: { body: string; headers: Record<string, string>; addresses: AddressRecord[] }) => Promise<Response>;

let addressLookup: AddressLookup = (hostname) => dnsLookup(hostname, { all: true });
let bridgeTransport: BridgeTransport = pinnedHttpsTransport;

/** Test hook. Do not use in production paths. */
export function setMcpBridgeLookupForTests(fn?: AddressLookup) {
  addressLookup = fn ?? ((hostname) => dnsLookup(hostname, { all: true }));
}

/** Test hook. Do not use in production paths. */
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

function isDisallowedIpv4(value: string): boolean {
  const octets = parseIpv4Octets(value);
  if (!octets) return true;
  const [a, b] = octets;
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
    const firstHextet = hextets[0];
    if (hextets.every((hextet) => hextet === 0)) return true; // ::
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10
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

function pinnedHttpsTransport(url: URL, init: { body: string; headers: Record<string, string>; addresses: AddressRecord[] }): Promise<Response> {
  const { addresses, body, headers } = init;
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
      reject(Object.assign(new Error("TimeoutError"), { name: "TimeoutError" }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("mcp_response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
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
  const { url, addresses } = await validateEndpoint(input.endpoint);
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
    response = await bridgeTransport(url, { body, headers, addresses });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    if (error instanceof Error && error.message === "mcp_response_too_large") throw error;
    throw new Error("mcp_bridge_network_failed");
  }
  const text = await readLimited(response);
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
