import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type McpBridgeRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };
export type McpBridgeResult = { ok: boolean; status: number; headers: Record<string, string>; data: unknown };
export type AddressLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

let addressLookup: AddressLookup = (hostname) => dnsLookup(hostname, { all: true });

/** Test hook. Do not use in production paths. */
export function setMcpBridgeLookupForTests(fn?: AddressLookup) {
  addressLookup = fn ?? ((hostname) => dnsLookup(hostname, { all: true }));
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
    if (hextets.every((hextet) => hextet === 0)) return true; // ::
    if (hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0 && hextets[6] === 0 && hextets[7] === 1) return true; // ::1
    if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if (hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0xffff) {
      return isDisallowedIpv4(hextetsToIpv4(hextets[6], hextets[7]));
    }
    if (hextets[0] === 0x2002) return isDisallowedIpv4(hextetsToIpv4(hextets[1], hextets[2])); // 6to4
    if (hextets[0] === 0x64 && hextets[1] === 0xff9b && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0) {
      return isDisallowedIpv4(hextetsToIpv4(hextets[6], hextets[7])); // NAT64 well-known prefix
    }
    return false;
  }
  return false;
}

async function validateEndpoint(endpoint: string): Promise<URL> {
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
    return url;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await addressLookup(host);
  } catch {
    throw new Error("mcp_endpoint_unresolvable");
  }
  if (!records.length) throw new Error("mcp_endpoint_unresolvable");
  for (const record of records) {
    if (isDisallowedAddress(record.address)) throw new Error("mcp_endpoint_local_target");
  }
  return url;
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
  const endpoint = await validateEndpoint(input.endpoint);
  let body: string;
  try { body = JSON.stringify(input.request); } catch { throw new Error("mcp_request_invalid_json"); }
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) throw new Error("mcp_request_too_large");
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": "Conduit/0.6.0" }, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("mcp_bridge_timeout");
    throw new Error("mcp_bridge_network_failed");
  }
  const text = await readLimited(response);
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    if (["content-type", "mcp-session-id", "www-authenticate", "retry-after"].includes(key.toLowerCase())) headers[key] = value;
  }
  return { ok: response.ok, status: response.status, headers, data };
}
