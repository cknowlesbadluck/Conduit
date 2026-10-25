import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { classifyHttpError, jsonErrorHandler } from "./http-errors.js";
import { createConduitApp } from "./app-factory.js";

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}

test("classifyHttpError maps body-parser types, defaults to 500", () => {
  assert.deepEqual(classifyHttpError({ type: "entity.parse.failed" }), { status: 400, code: "invalid_json" });
  assert.deepEqual(classifyHttpError({ type: "entity.too.large" }), { status: 413, code: "payload_too_large" });
  assert.deepEqual(classifyHttpError({ type: "toString" }), { status: 500, code: "internal_error" });
  assert.deepEqual(classifyHttpError({ status: 400, type: "custom" }), { status: 500, code: "internal_error" });
  assert.deepEqual(classifyHttpError(null), { status: 500, code: "internal_error" });
  assert.deepEqual(classifyHttpError("boom"), { status: 500, code: "internal_error" });
});

test("thrown route errors return generic JSON 500 without message or stack", async () => {
  const app = express();
  app.get("/boom", () => { throw new Error("SECRET db password=hunter2"); });
  app.use(jsonErrorHandler);
  const orig = console.error; console.error = () => {};
  try {
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/boom`);
      const body = await res.text();
      assert.equal(res.status, 500);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/);
      assert.deepEqual(JSON.parse(body), { error: "internal_error" });
      assert.doesNotMatch(body, /SECRET|hunter2|at /);
    });
  } finally { console.error = orig; }
});

test("conduit app: malformed JSON -> 400 invalid_json, no parser detail echoed", async () => {
  await withServer(createConduitApp(), async (base) => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{\"a\": SECRETTOKEN" });
    const body = await res.text();
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(body), { error: "invalid_json" });
    assert.doesNotMatch(body, /SECRETTOKEN|Unexpected|<pre>/);
  });
});

test("conduit app: oversized JSON -> 413 payload_too_large", async () => {
  await withServer(createConduitApp(), async (base) => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "a".repeat(1024 * 1024 + 10) }) });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: "payload_too_large" });
  });
});
