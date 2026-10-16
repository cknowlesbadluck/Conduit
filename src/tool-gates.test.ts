import test from "node:test";
import assert from "node:assert/strict";
import { init } from "./store.js";
import { createConduitServer } from "./mcp.js";
import type { ConduitAuthConfig } from "./auth.js";

/**
 * Roadmap phase 7 exit criterion: "every tool declares a gate". Behavioural, not textual:
 * every registered tool is invoked with an authenticated caller holding NO scopes, and must
 * refuse. A new tool that forgets its scope check fails this test (deny-by-default).
 */
const authConfig = {
  enabled: true, issuer: "https://issuer.invalid", discoveryUrl: "https://issuer.invalid/.well-known", resourceUrl: "https://conduit.invalid/mcp",
  metadata: {} as ConduitAuthConfig["metadata"], readScope: "conduit:read", writeScope: "conduit:write",
} as ConduitAuthConfig;

const noScopes = { http: { authInfo: { token: "t", clientId: "client", scopes: [] as string[], extra: { sub: "subject" } } } };
const input = new Proxy({} as Record<string, unknown>, { get: (_t, k) => (k === "then" ? undefined : k === "limit" ? 10 : k === "method" ? "GET" : k === "provider" ? "github" : k === "path" ? "/user" : k === "endpoint" ? "https://example.invalid/mcp" : "x") });

// Tools that are intentionally available to any authenticated caller. Keep this list empty
// unless there is a written reason; additions are reviewed.
const PUBLIC_TO_AUTHENTICATED = new Set<string>([]);

test("every MCP tool refuses an authenticated caller with no scopes", async () => {
  await init();
  const server = createConduitServer(authConfig) as unknown as { _registeredTools: Record<string, { handler: (i: unknown, e: unknown) => Promise<{ isError?: boolean; content?: Array<{ text?: string }> }> }> };
  const tools = Object.entries(server._registeredTools);
  assert.ok(tools.length >= 30, `expected the full tool surface, got ${tools.length}`);
  const ungated: string[] = [];
  for (const [name, tool] of tools) {
    if (PUBLIC_TO_AUTHENTICATED.has(name)) continue;
    let refused = false;
    try {
      const result = await tool.handler(input, noScopes);
      const text = JSON.stringify(result?.content ?? "");
      refused = result?.isError === true && /scope|insufficient|unauthori|forbidden/i.test(text);
    } catch (error) {
      refused = /scope|insufficient/i.test(String((error as Error)?.message ?? error));
    }
    if (!refused) ungated.push(name);
  }
  assert.deepEqual(ungated, [], `tools without a scope gate: ${ungated.join(", ")}`);
});

test("the gate check is meaningful: with read scope, a read tool is not refused", async () => {
  await init();
  const server = createConduitServer(authConfig) as unknown as { _registeredTools: Record<string, { handler: (i: unknown, e: unknown) => Promise<{ isError?: boolean }> }> };
  const withRead = { http: { authInfo: { ...noScopes.http.authInfo, scopes: ["conduit:read"] } } };
  const result = await server._registeredTools.development_context.handler({}, withRead);
  assert.notEqual(result?.isError, true);
});
