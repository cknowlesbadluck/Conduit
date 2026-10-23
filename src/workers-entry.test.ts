import test from "node:test";
import assert from "node:assert/strict";

test("Workers fetch handler never fabricates readiness, status counts, or MCP", async () => {
  process.env.CLOUDFLARE_WORKER = "1"; // prevent the Node server from booting on import
  const { fetchHandler } = await import("./index.js");
  for (const path of ["/ready", "/status", "/diagnostics", "/mcp", "/events"]) {
    const res = await fetchHandler(new Request(`https://w.example${path}`));
    assert.equal(res.status, 503, path);
    const body = await res.json() as { status: string; reason: string };
    assert.equal(body.status, "not_supported", path);
    assert.equal(body.reason, "workers_runtime_unsupported", path);
  }
  const health = await fetchHandler(new Request("https://w.example/health"));
  assert.equal(health.status, 200);
  const root = await fetchHandler(new Request("https://w.example/anything"));
  const info = await root.json() as { status: string; mcp: string };
  assert.equal(info.status, "workers_static_only");
  assert.equal(info.mcp, "not_supported");
  assert.equal((await fetchHandler(new Request("https://w.example/"))).status, 200);
});
