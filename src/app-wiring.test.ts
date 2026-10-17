import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { init } from "./store.js";
import { conduitAppOptionsFromEnv, createConduitApp, type ConduitAppOptions } from "./app-factory.js";

const quiet = { log() {}, warn() {}, error() {} };

async function withApp(options: ConduitAppOptions, fn: (port: number) => Promise<void>) {
  await init();
  const server = createServer(createConduitApp({ log: quiet, ...options }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try { await fn((server.address() as AddressInfo).port); } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
}

function call(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: init.headers }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; if (res.headers["content-type"]?.includes("event-stream")) { req.destroy(); resolve({ status: res.statusCode!, headers: res.headers, body }); } });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", (e) => (e.message.includes("aborted") || (e as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : reject(e)));
    if (init.body) req.write(init.body);
    req.end();
  });
}

test("options from env: dev modes only with explicit opt-in; hosts and origins parsed like before", () => {
  const prod = conduitAppOptionsFromEnv({ NODE_ENV: "production", CONDUIT_TOKEN: "t", CONDUIT_ALLOW_ANONYMOUS: "true", PUBLIC_URL: "https://conduit.example.com", MCP_ALLOWED_ORIGINS: "https://a.example/x, https://b.example" }, null);
  assert.equal(prod.devToken, undefined);
  assert.equal(prod.anonymous, false);
  assert.deepEqual(prod.allowedHostnames, ["localhost", "127.0.0.1", "[::1]", "conduit.example.com"]);
  assert.deepEqual(prod.allowedOrigins, ["https://a.example", "https://b.example"]);
  const dev = conduitAppOptionsFromEnv({ CONDUIT_DEV_MODE: "true", CONDUIT_TOKEN: "t", CONDUIT_ALLOW_ANONYMOUS: "true" }, null);
  assert.equal(dev.devToken, "t");
  assert.equal(dev.anonymous, true);
  assert.throws(() => conduitAppOptionsFromEnv({ PUBLIC_URL: "not a url" }, null), /PUBLIC_URL/);
  assert.throws(() => conduitAppOptionsFromEnv({ MCP_ALLOWED_ORIGINS: "nope" }, null), /MCP_ALLOWED_ORIGINS/);
});

test("production wiring: host validation, security headers, CORS and preflight", async () => {
  await withApp({ allowedHostnames: ["localhost", "127.0.0.1"], allowedOrigins: [] }, async (port) => {
    const ok = await call(port, "/health");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["x-content-type-options"], "nosniff");
    assert.equal(ok.headers["access-control-allow-origin"], "*");
    assert.equal(ok.headers["x-powered-by"], undefined);
    const badHost = await call(port, "/health", { headers: { Host: "evil.example" } });
    assert.equal(badHost.status, 403);
    const preflight = await call(port, "/mcp", { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.match(String(preflight.headers["access-control-allow-headers"]), /MCP-Protocol-Version/);
  });
  await withApp({ allowedHostnames: ["127.0.0.1"], allowedOrigins: ["https://ok.example"] }, async (port) => {
    const allowed = await call(port, "/health", { headers: { Origin: "https://ok.example" } });
    assert.equal(allowed.headers["access-control-allow-origin"], "https://ok.example");
    const denied = await call(port, "/health", { headers: { Origin: "https://evil.example" } });
    assert.equal(denied.status, 403);
  });
});

test("no auth configured: /mcp and /events fail closed with 503", async () => {
  await withApp({}, async (port) => {
    const mcp = await call(port, "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(mcp.status, 503);
    assert.match(mcp.body, /auth_not_configured/);
    const events = await call(port, "/events");
    assert.equal(events.status, 503);
  });
});

test("dev token mode: wrong/missing token is 401 on /mcp and /events; right token streams events", async () => {
  await withApp({ devToken: "secret-dev-token" }, async (port) => {
    assert.equal((await call(port, "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await call(port, "/mcp", { method: "POST", headers: { Authorization: "Bearer nope", "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await call(port, "/events")).status, 401);
    const stream = await call(port, "/events", { headers: { Authorization: "Bearer secret-dev-token" } });
    assert.equal(stream.status, 200);
    assert.match(String(stream.headers["content-type"]), /text\/event-stream/);
  });
});

test("request ids are opt-in", async () => {
  await withApp({ requestIds: true }, async (port) => {
    assert.ok((await call(port, "/health")).headers["x-request-id"]);
  });
  await withApp({}, async (port) => {
    assert.equal((await call(port, "/health")).headers["x-request-id"], undefined);
  });
});
