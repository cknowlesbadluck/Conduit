#!/usr/bin/env node
/**
 * Fail-closed production verification for public Conduit endpoints.
 * Never prints secret environment values.
 */
const baseUrl = (process.env.CONDUIT_URL || "https://conduit-feco.onrender.com").replace(/\/$/, "");
const expectedResource = process.env.MCP_RESOURCE || `${baseUrl}/mcp`;

function fail(message) {
  console.error(`verify-production: ${message}`);
  process.exit(1);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const health = await getJson("/health");
if (health.body.status !== "ok") fail(`health status is ${health.body.status}`);

const ready = await getJson("/ready");
if (ready.body.status !== "ready") fail(`ready status is ${ready.body.status}`);
if (typeof ready.body.version !== "string" || !ready.body.version) fail("ready response missing version");

const root = await getJson("/.well-known/oauth-protected-resource");
const path = await getJson("/.well-known/oauth-protected-resource/mcp");
if (JSON.stringify(root.body) !== JSON.stringify(path.body)) fail("protected-resource metadata locations diverge");
if (root.body.resource !== expectedResource) fail("protected-resource metadata resource mismatch");
const scopes = root.body.scopes_supported || [];
if (!scopes.includes("mcp:conduit.read") || !scopes.includes("mcp:conduit.write")) fail("scope parity failed");

const mcp = await fetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-production", version: "1.0.0" } },
  }),
  signal: AbortSignal.timeout(15000),
});
if (mcp.status !== 401) fail(`/mcp without credentials returned HTTP ${mcp.status}`);
const challenge = mcp.headers.get("www-authenticate") || "";
if (!/Bearer/i.test(challenge) || !/resource_metadata/i.test(challenge)) fail("missing WWW-Authenticate challenge");

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  version: ready.body.version,
  persistence: ready.body.persistence ?? null,
  resource: root.body.resource,
}, null, 2));
