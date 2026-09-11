const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
// Optimization: Reuse a static TextEncoder instance to avoid repeated object allocations on every bridge request.
const textEncoder = new TextEncoder();

export type McpBridgeRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };
export type McpBridgeResult = { ok: boolean; status: number; headers: Record<string, string>; data: unknown };

function validateEndpoint(endpoint: string): URL {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("mcp_endpoint_invalid"); }
  if (url.protocol !== "https:") throw new Error("mcp_endpoint_must_be_https");
  if (url.username || url.password) throw new Error("mcp_endpoint_invalid");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "localhost.localdomain" || host === "::1" || host === "127.0.0.1" || host === "0.0.0.0" || host === "169.254.169.254" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("mcp_endpoint_local_target");
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) throw new Error("mcp_endpoint_local_target");
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
  const endpoint = validateEndpoint(input.endpoint);
  let body: string;
  try { body = JSON.stringify(input.request); } catch { throw new Error("mcp_request_invalid_json"); }
  if (textEncoder.encode(body).byteLength > MAX_REQUEST_BYTES) throw new Error("mcp_request_too_large");
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
