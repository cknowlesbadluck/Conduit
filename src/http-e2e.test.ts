import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConduitApp } from "./app-factory.js";
import { MCP_PROTOCOL_VERSION, SERVICE_NAME } from "./version.js";

const mcpHeaders = (sessionId?: string) => ({
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  ...(sessionId ? { "MCP-Session-Id": sessionId } : {}),
});

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
    const initializeBody = await initialize.json() as { result?: { serverInfo?: { name?: string } } };
    assert.equal(initializeBody.result?.serverInfo?.name, SERVICE_NAME);

    const sessionId = initialize.headers.get("MCP-Session-Id");
    assert.ok(sessionId);

    const tools = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(tools.status, 200);
    const toolsBody = await tools.json() as { result?: { tools?: Array<{ name: string }> } };
    assert.ok(toolsBody.result?.tools?.some((tool) => tool.name === "agent_identity"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
