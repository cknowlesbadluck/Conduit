import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConduitApp } from "./app-factory.js";
import { init } from "./store.js";

async function withServer(run: (baseUrl: string) => Promise<void>) {
  await init();
  const server = createServer(createConduitApp({ anonymous: true }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("root serves the schematic UI without external dependencies", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy") ?? "", /style-src 'self'/);
    assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.match(html, /CONDUIT/);
    assert.match(html, /CONDUIT<\/strong>/);
    assert.match(html, /href="\/ui\.css"/);
    assert.match(html, /src="\/ui\.js"/);
    assert.match(html, /Connections/);
    assert.match(html, /Tools/);
    assert.match(html, /Tasks/);
    assert.match(html, /Activity/);
  });
});

test("ui.css serves formatted CSS stylesheet", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ui.css`);
    const css = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/css/);
    assert.match(css, /:root/);
    assert.match(css, /color-scheme:\s*dark/);
    assert.match(css, /\.shell/);
    assert.match(css, /\.layout/);
  });
});

test("status is JSON and existing health/ready endpoints remain available", async () => {
  await withServer(async (baseUrl) => {
    const [status, health, ready] = await Promise.all([
      fetch(`${baseUrl}/status`),
      fetch(`${baseUrl}/health`),
      fetch(`${baseUrl}/ready`),
    ]);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get("content-type")?.includes("application/json"), true);
    const body = await status.json() as { service: string; status: string; connections: unknown[]; tasks: unknown[]; activity: unknown[]; counts?: { agents: number } };
    assert.equal(body.service, "Conduit");
    assert.equal(body.status, "online");
    assert.ok(Array.isArray(body.connections));
    assert.equal(body.connections.length, 0);
    assert.equal(body.tasks.length, 0);
    assert.equal(body.activity.length, 0);
    assert.ok(body.counts);
    assert.equal(health.status, 200);
    assert.equal(ready.status, 200);
  });
});

test("MCP route keeps the existing anonymous development path", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.notEqual(response.status, 503);
  });
});

test("public UI script prefers counts over empty coordination arrays", async () => {
  const { CONDUIT_UI_JS } = await import("./ui.js");
  assert.match(CONDUIT_UI_JS, /if \(data\.counts\)/);
  assert.match(CONDUIT_UI_JS, /Public projection/);
  assert.match(CONDUIT_UI_JS, /Identifiers omitted from public \/status/);
});
