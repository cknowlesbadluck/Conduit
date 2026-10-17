import test from "node:test";
import assert from "node:assert/strict";
import { callMcpBridge, isDisallowedAddress, pinnedLookup, setMcpBridgeDeadlineForTests, setMcpBridgeLookupForTests, setMcpBridgeTransportForTests } from "./mcp-bridge.js";
import { MCP_PROTOCOL_VERSION, SERVICE_NAME, VERSION } from "./version.js";

test.afterEach(() => {
  setMcpBridgeLookupForTests();
  setMcpBridgeTransportForTests();
});

test("MCP bridge rejects non-HTTPS endpoints and local targets", async () => {
  await assert.rejects(() => callMcpBridge({ endpoint: "http://example.com/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_must_be_https/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://localhost/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://127.0.0.1/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://169.254.169.254/latest/meta-data", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[::1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[::ffff:127.0.0.1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[fd00::1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[2002:7f00:1::1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[64:ff9b::7f00:1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://224.0.0.1/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[ff02::1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[2001:db8::1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://0.0.0.1/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://metadata.google.internal/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[::7f00:1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://[::127.0.0.1]/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_endpoint_local_target/);
});

test("isDisallowedAddress rejects IPv4-compatible IPv6 embeddings", () => {
  assert.equal(isDisallowedAddress("::7f00:1"), true);
  assert.equal(isDisallowedAddress("::127.0.0.1"), true);
  assert.equal(isDisallowedAddress("::1"), true);
  assert.equal(isDisallowedAddress("2001:4860:4860::8888"), false);
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

test("pinned lookup refuses to resolve a different hostname", async () => {
  const lookup = pinnedLookup("mcp.example.test", [{ address: "203.0.113.10", family: 4 }]);
  await assert.rejects(() => lookup("evil.example.test"), /mcp_endpoint_host_mismatch/);
  assert.deepEqual(await lookup("mcp.example.test"), [{ address: "203.0.113.10", family: 4 }]);
});

test("MCP bridge forwards JSON-RPC, pins validated addresses, and advertises protocol version", async () => {
  setMcpBridgeLookupForTests(async () => [{ address: "203.0.113.10", family: 4 }]);
  let seenUrl = "";
  let seenBody = "";
  let seenHeaders: Record<string, string> = {};
  let seenAddresses: Array<{ address: string; family: number }> = [];
  setMcpBridgeTransportForTests(async (url, init) => {
    seenUrl = url.toString();
    seenBody = init.body;
    seenHeaders = init.headers;
    seenAddresses = init.addresses;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { tools: [] } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 7, method: "tools/list" } });
  assert.equal(seenUrl, "https://mcp.example.test/mcp");
  assert.deepEqual(JSON.parse(seenBody), { jsonrpc: "2.0", id: 7, method: "tools/list" });
  assert.equal(seenHeaders["User-Agent"], `${SERVICE_NAME}/${VERSION}`);
  assert.equal(seenHeaders["MCP-Protocol-Version"], MCP_PROTOCOL_VERSION);
  assert.deepEqual(seenAddresses, [{ address: "203.0.113.10", family: 4 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { jsonrpc: "2.0", id: 7, result: { tools: [] } });
});

test("MCP bridge returns redirect responses without following them", async () => {
  setMcpBridgeLookupForTests(async () => [{ address: "203.0.113.10", family: 4 }]);
  setMcpBridgeTransportForTests(async () => new Response("", { status: 302, headers: { location: "https://127.0.0.1/steal" } }));
  const result = await callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 302);
});

test("MCP bridge rejects oversized request bodies", async () => {
  setMcpBridgeLookupForTests(async () => [{ address: "203.0.113.10", family: 4 }]);
  const huge = "x".repeat(300 * 1024);
  await assert.rejects(() => callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { huge } } }), /mcp_request_too_large/);
});

test("MCP bridge enforces a total deadline when the transport never answers", async () => {
  setMcpBridgeLookupForTests(async () => [{ address: "203.0.113.10", family: 4 }]);
  setMcpBridgeTransportForTests(() => new Promise<Response>(() => undefined));
  setMcpBridgeDeadlineForTests(50);
  try {
    const started = Date.now();
    await assert.rejects(() => callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_bridge_timeout/);
    assert.ok(Date.now() - started < 2000, "deadline bounds the call");
  } finally {
    setMcpBridgeDeadlineForTests();
    setMcpBridgeTransportForTests();
  }
});

test("MCP bridge cancels a body that drips past the deadline (slow-drip peer)", async () => {
  setMcpBridgeLookupForTests(async () => [{ address: "203.0.113.10", family: 4 }]);
  let cancelled = false;
  let interval: NodeJS.Timeout | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { interval = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), 5); },
    cancel() { cancelled = true; clearInterval(interval); },
  });
  setMcpBridgeTransportForTests(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
  setMcpBridgeDeadlineForTests(60);
  try {
    await assert.rejects(() => callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_bridge_timeout/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(cancelled, true, "stalled body is cancelled, not left open");
  } finally {
    clearInterval(interval);
    setMcpBridgeDeadlineForTests();
    setMcpBridgeTransportForTests();
  }
});

test("MCP bridge deadline covers DNS resolution (a hung resolver cannot stall the call)", async () => {
  setMcpBridgeLookupForTests(() => new Promise(() => undefined));
  let transportCalled = false;
  setMcpBridgeTransportForTests(async () => { transportCalled = true; return new Response("{}", { status: 200 }); });
  setMcpBridgeDeadlineForTests(50);
  try {
    const started = Date.now();
    await assert.rejects(() => callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_bridge_timeout/);
    assert.ok(Date.now() - started < 2000);
    assert.equal(transportCalled, false);
  } finally { setMcpBridgeDeadlineForTests(); }
});

test("MCP bridge shares one budget across DNS and connect, and aborts the transport (socket release) at the deadline", async () => {
  setMcpBridgeLookupForTests(() => new Promise((resolve) => setTimeout(() => resolve([{ address: "203.0.113.10", family: 4 }]), 40)));
  let seen: { signal?: AbortSignal; deadlineMs?: number } = {};
  let abortedAt = 0;
  setMcpBridgeTransportForTests((_url, init) => {
    seen = init;
    init.signal?.addEventListener("abort", () => { abortedAt = Date.now(); });
    return new Promise<Response>(() => undefined); // connect never completes
  });
  setMcpBridgeDeadlineForTests(100);
  try {
    const started = Date.now();
    await assert.rejects(() => callMcpBridge({ endpoint: "https://mcp.example.test/mcp", request: { jsonrpc: "2.0", id: 1, method: "tools/list" } }), /mcp_bridge_timeout/);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 400, `total budget respected (${elapsed}ms)`);
    assert.ok(seen.deadlineMs !== undefined && seen.deadlineMs <= 70, `transport got only the remaining budget (${seen.deadlineMs})`);
    assert.equal(seen.signal?.aborted, true, "transport signal aborted so the socket is destroyed");
    assert.ok(abortedAt > 0);
  } finally { setMcpBridgeDeadlineForTests(); }
});
