import test from "node:test";
import assert from "node:assert/strict";
import { callMcpBridge, setMcpBridgeLookupForTests } from "./mcp-bridge.js";

test.afterEach(() => {
  setMcpBridgeLookupForTests();
});

test("MCP bridge rejects non-HTTPS endpoints and local targets", async () => {
  await assert.rejects(() => callMcpBridge({ endpoint: "http://example.com/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_must_be_https/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://localhost/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://127.0.0.1/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://169.254.169.254/latest/meta-data", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[::1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[fd00::1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://metadata.google.internal/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
});

test("MCP bridge rejects hostnames that resolve to private addresses", async () => {
  setMcpBridgeLookupForTests(async () => [{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(
    () => callMcpBridge({ endpoint: "https://evil.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }),
    /mcp_endpoint_local_target/,
  );
});

test("MCP bridge rejects unresolvable hostnames", async () => {
  setMcpBridgeLookupForTests(async () => { throw new Error("ENOTFOUND"); });
  await assert.rejects(
    () => callMcpBridge({ endpoint: "https://missing.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }),
    /mcp_endpoint_unresolvable/,
  );
});

test("MCP bridge forwards JSON-RPC and returns parsed response", async () => {
  setMcpBridgeLookupForTests(async () => [{ address: "203.0.113.10", family: 4 }]);
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
  setMcpBridgeLookupForTests(async () => [{ address: "203.0.113.10", family: 4 }]);
  const huge = "x".repeat(300 * 1024);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { huge } } }), /mcp_request_too_large/);
});
