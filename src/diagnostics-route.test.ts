import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createDiagnosticsHandler } from "./diagnostics-route.js";

async function withApp(handler: express.RequestHandler, fn: (base: string) => Promise<void>) {
  const app = express();
  app.get("/diagnostics", handler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { server.close(); }
}

test("diagnostics results are cached per target within the TTL", async () => {
  let calls = 0; let clock = 0;
  const run = (async () => { calls += 1; return { ok: true, n: calls }; }) as never;
  await withApp(createDiagnosticsHandler(undefined, { cacheTtlMs: 1000, run, now: () => clock }), async (base) => {
    const a = await fetch(`${base}/diagnostics`);
    assert.equal(a.headers.get("x-conduit-diagnostics-cache"), "miss");
    const b = await fetch(`${base}/diagnostics`);
    assert.equal(b.headers.get("x-conduit-diagnostics-cache"), "hit");
    assert.deepEqual(await b.json(), { ok: true, n: 1 });
    assert.equal(calls, 1);
    clock = 1001;
    const c = await fetch(`${base}/diagnostics`);
    assert.equal(c.headers.get("x-conduit-diagnostics-cache"), "miss");
    assert.equal(calls, 2);
  });
});

test("cache can be disabled with ttl 0", async () => {
  let calls = 0;
  const run = (async () => { calls += 1; return {}; }) as never;
  await withApp(createDiagnosticsHandler(undefined, { cacheTtlMs: 0, run }), async (base) => {
    await fetch(`${base}/diagnostics`); await fetch(`${base}/diagnostics`);
    assert.equal(calls, 2);
  });
});
