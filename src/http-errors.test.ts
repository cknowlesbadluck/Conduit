import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { createConduitApp } from "./app-factory.js";
import { jsonErrorHandler } from "./http-errors.js";
import { init } from "./store.js";

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

test("malformed JSON on /mcp is a JSON-RPC parse error, not an HTML stack page", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development"; // the default handler would include err.stack here
  try {
    await init();
    await withServer(createConduitApp({ anonymous: true }), async (base) => {
      const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
      assert.equal(response.status, 400);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      assert.equal(/at\s+\S+\s+\(|node_modules|SyntaxError/.test(text), false);
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test("thrown route errors become a generic 500 without message or stack; oversize bodies 413", async () => {
  const app = express();
  app.use(express.json({ limit: "10b" }));
  app.get("/boom", () => { throw new Error("secret-detail postgres://u:p@h/db"); });
  app.post("/echo", (req, res) => { res.json(req.body); });
  app.use(jsonErrorHandler);
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
  try {
    await withServer(app, async (base) => {
      const boom = await fetch(`${base}/boom`);
      assert.equal(boom.status, 500);
      const text = await boom.text();
      assert.deepEqual(JSON.parse(text), { error: "internal_error" });
      assert.equal(text.includes("secret-detail"), false);
      const big = await fetch(`${base}/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: "x".repeat(100) }) });
      assert.equal(big.status, 413);
      assert.deepEqual(await big.json(), { error: "payload_too_large" });
      const bad = await fetch(`${base}/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{x" });
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { error: "invalid_json" });
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.some((line) => line.includes("secret-detail")), false);
});
