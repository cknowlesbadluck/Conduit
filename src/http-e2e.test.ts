import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConduitApp } from "./app-factory.js";
import { MCP_PROTOCOL_VERSION, SERVICE_NAME } from "./version.js";
import { init } from "./store.js";
import type { ConduitAuthConfig } from "./auth.js";
import type { AuthInfo } from "@modelcontextprotocol/server";

function testAuthConfig(resourceUrl: string): ConduitAuthConfig {
  return {
    enabled: true,
    issuer: "https://auth.example.test/issuer",
    discoveryUrl: "https://auth.example.test/.well-known/oauth-authorization-server",
    resourceUrl,
    metadata: {
      issuer: "https://auth.example.test/issuer",
      jwks_uri: "https://auth.example.test/jwks",
      authorization_endpoint: "https://auth.example.test/authorize",
      token_endpoint: "https://auth.example.test/token",
      response_types_supported: ["code"],
    },
    readScope: "mcp:conduit.read",
    writeScope: "mcp:conduit.write",
  };
}

const mcpHeaders = () => ({
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
});

async function readMcpResponse(response: Response) {
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  assert.ok(dataLine, `expected MCP SSE data event, received: ${text}`);
  return JSON.parse(dataLine.slice("data: ".length)) as { result?: Record<string, unknown> };
}

test("black-box MCP HTTP initializes and lists tools", async () => {
  const app = createConduitApp({ anonymous: true });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const initialize = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "conduit-http-e2e", version: "0.8.0-test" },
        },
      }),
    });
    assert.equal(initialize.status, 200);
    const initializeBody = await readMcpResponse(initialize);
    const initializeResult = initializeBody.result as { serverInfo?: { name?: string } } | undefined;
    assert.equal(initializeResult?.serverInfo?.name, SERVICE_NAME);

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(tools.status, 200);
    const toolsBody = await readMcpResponse(tools);
    const toolsResult = toolsBody.result as { tools?: Array<{ name: string }> } | undefined;
    assert.ok(toolsResult?.tools?.some((tool) => tool.name === "agent_identity"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("black-box MCP HTTP authentication path challenges then accepts a test verifier", async () => {
  await init();
  const serverHolder: { app?: ReturnType<typeof createConduitApp> } = {};
  const server = createServer((req, res) => serverHolder.app!(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const authConfig = testAuthConfig(`${baseUrl}/mcp`);
    serverHolder.app = createConduitApp({
      authConfig,
      tokenVerifier: {
        async verifyAccessToken(token: string): Promise<AuthInfo> {
          if (token !== "test-access-token") throw new Error("invalid_token");
          return {
            token,
            clientId: "test-client",
            scopes: ["mcp:conduit.read", "mcp:conduit.write"],
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            extra: { sub: "test-subject" },
          };
        },
      },
    });

    const unauthenticated = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "conduit-http-e2e", version: "0.8.0-test" },
        },
      }),
    });
    assert.equal(unauthenticated.status, 401);
    const challenge = unauthenticated.headers.get("www-authenticate") ?? "";
    assert.match(challenge, /Bearer/i);
    assert.match(challenge, /resource_metadata/i);

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    const readyBody = await ready.json() as { status: string; version: string; persistence: string };
    assert.equal(readyBody.status, "ready");
    assert.equal(readyBody.persistence, "memory");

    const initialize = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders(), Authorization: "Bearer test-access-token" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "conduit-http-e2e", version: "0.8.0-test" },
        },
      }),
    });
    assert.equal(initialize.status, 200);
    const initializeBody = await readMcpResponse(initialize);
    const initializeResult = initializeBody.result as { serverInfo?: { name?: string } } | undefined;
    assert.equal(initializeResult?.serverInfo?.name, SERVICE_NAME);

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders(), Authorization: "Bearer test-access-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    });
    assert.equal(tools.status, 200);
    const toolsBody = await readMcpResponse(tools);
    const toolsResult = toolsBody.result as { tools?: Array<{ name: string }> } | undefined;
    assert.ok(toolsResult?.tools?.some((tool) => tool.name === "agent_identity"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
