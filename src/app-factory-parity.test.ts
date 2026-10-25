import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createConduitApp } from "./app-factory.js";

async function withServer(app: ReturnType<typeof createConduitApp>, fn: (base: string) => Promise<void>) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}

test("production options: host validation rejects unknown Host header", async () => {
  await withServer(createConduitApp({ allowedHostnames: ["localhost", "127.0.0.1"], cors: true }), async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/health`, { headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject); req.end();
    });
    assert.equal(status, 403);
  });
});

test("production options: CORS preflight is 204 and echoes only allowlisted origins", async () => {
  await withServer(createConduitApp({ allowedHostnames: ["127.0.0.1"], allowedOrigins: ["http://127.0.0.1"], cors: true }), async (base) => {
    const ok = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1" } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://127.0.0.1");
    const bad = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { Origin: "http://evil.example" } });
    assert.notEqual(bad.headers.get("access-control-allow-origin"), "http://evil.example");
  });
});

test("dev token mode: /mcp and /events reject missing or wrong bearer with 401", async () => {
  await withServer(createConduitApp({ devToken: "s3cret", eventsHandler: (_req, res) => { res.status(200).end("ok"); } }), async (base) => {
    for (const path of ["/mcp", "/events"]) {
      const none = await fetch(`${base}${path}`, { method: path === "/mcp" ? "POST" : "GET" });
      assert.equal(none.status, 401, path);
      assert.match(none.headers.get("www-authenticate") ?? "", /Bearer/);
      const wrong = await fetch(`${base}${path}`, { method: path === "/mcp" ? "POST" : "GET", headers: { Authorization: "Bearer nope" } });
      assert.equal(wrong.status, 401, path);
    }
    const good = await fetch(`${base}/events`, { headers: { Authorization: "Bearer s3cret" } });
    assert.equal(good.status, 200);
  });
});

test("no auth configured: /mcp and /events fail closed with 503 auth_not_configured", async () => {
  await withServer(createConduitApp({ eventsHandler: (_req, res) => { res.status(200).end(); } }), async (base) => {
    for (const path of ["/mcp", "/events"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 503, path);
      assert.equal(((await res.json()) as { error: string }).error, "auth_not_configured");
    }
  });
});
