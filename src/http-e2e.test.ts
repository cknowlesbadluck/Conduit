import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConduitApp } from "./app-factory.js";
import { MCP_PROTOCOL_VERSION, SERVICE_NAME } from "./version.js";

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
