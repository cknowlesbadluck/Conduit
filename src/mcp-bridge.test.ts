import test from "node:test";
import assert from "node:assert/strict";
import { callMcpBridge } from "./mcp-bridge.js";

test("MCP bridge rejects non-HTTPS endpoints and local targets", async () => {
  await assert.rejects(() => callMcpBridge({ endpoint: "http://example.com/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_must_be_https/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://localhost/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://127.0.0.1/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
});

test("MCP bridge forwards JSON-RPC and returns parsed response", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenBody = "";
  try {
    globalThis.fetch = async (url, init) => {
      seenUrl = String(url);
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { tools: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 7, method: "tools/list" } });
    assert.equal(seenUrl, "https://mcp.example.test/mcp");
    assert.deepEqual(JSON.parse(seenBody), { jsonrpc: "2.0", id: 7, method: "tools/list" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { jsonrpc: "2.0", id: 7, result: { tools: [] } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MCP bridge rejects oversized request bodies", async () => {
  const huge = "x".repeat(300 * 1024);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { huge } } }), /mcp_request_too_large/);
});
