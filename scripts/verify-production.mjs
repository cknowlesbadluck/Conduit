#!/usr/bin/env node
/**
 * Production release verification for Conduit.
 * Uses only public endpoints. Never prints secrets or env values that look like credentials.
 *
 * Usage:
 *   node scripts/verify-production.mjs [baseUrl]
 * Env:
 *   CONDUIT_URL — override base (default https://conduit-feco.onrender.com)
 *   CONDUIT_EXPECT_VERSION — optional exact version string (e.g. 0.8.0)
 */

const base = (process.argv[2] || process.env.CONDUIT_URL || "https://conduit-feco.onrender.com").replace(/\/$/, "");
const expectVersion = process.env.CONDUIT_EXPECT_VERSION?.trim();

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000), redirect: "error" });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`${path} returned non-JSON (status ${res.status})`);
  }
  return { status: res.status, headers: res.headers, body };
}

async function main() {
  console.log(`Verifying Conduit at ${base}`);

  const health = await getJson("/health");
  if (health.status !== 200 || health.body?.status !== "ok") fail(`/health unhealthy: ${JSON.stringify(health.body)}`);
  console.log("OK /health");

  const ready = await getJson("/ready");
  if (ready.status !== 200 || ready.body?.status !== "ready") fail(`/ready not ready: ${JSON.stringify(ready.body)}`);
  if (typeof ready.body?.version !== "string") fail("/ready missing version");
  if (expectVersion && ready.body.version !== expectVersion) {
    fail(`/ready version ${ready.body.version} != expected ${expectVersion}`);
  }
  console.log(`OK /ready version=${ready.body.version} persistence=${ready.body.persistence ?? "n/a"}`);

  const prm = await getJson("/.well-known/oauth-protected-resource");
  if (prm.status !== 200) fail(`PRM root status ${prm.status}`);
  if (!Array.isArray(prm.body?.authorization_servers) || prm.body.authorization_servers.length === 0) {
    fail("PRM missing authorization_servers");
  }
  const scopes = prm.body.scopes_supported || [];
  if (!scopes.includes("mcp:conduit.read") || !scopes.includes("mcp:conduit.write")) {
    fail(`PRM scopes incomplete: ${JSON.stringify(scopes)}`);
  }
  console.log("OK protected-resource metadata");

  const prmPath = await getJson("/.well-known/oauth-protected-resource/mcp");
  if (prmPath.status !== 200) fail(`PRM path status ${prmPath.status}`);
  console.log("OK protected-resource path metadata");

  const mcp = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "verify-production", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (mcp.status !== 401) fail(`MCP expected 401, got ${mcp.status}`);
  const www = mcp.headers.get("www-authenticate") || "";
  if (!/Bearer/i.test(www)) fail(`WWW-Authenticate missing Bearer: ${www}`);
  if (!/resource_metadata=/i.test(www)) fail(`WWW-Authenticate missing resource_metadata: ${www}`);
  console.log("OK MCP 401 challenge with resource_metadata");

  console.log("All production verification checks passed.");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
