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

export function isDisallowedAddress(address: string): boolean {
  const value = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(value) === 4) {
    return (
      value === "0.0.0.0" ||
      /^127\./.test(value) ||
      /^10\./.test(value) ||
      /^192\.168\./.test(value) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(value) ||
      /^169\.254\./.test(value) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(value)
    );
  }
  if (isIP(value) === 6) {
    if (value === "::1" || value.startsWith("fe80:") || value.startsWith("::ffff:")) return true;
    if (value.startsWith("fc") || value.startsWith("fd")) {
      const firstHextet = value.split(":", 1)[0] ?? "";
      return firstHextet.length >= 2 && (firstHextet.startsWith("fc") || firstHextet.startsWith("fd"));
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
