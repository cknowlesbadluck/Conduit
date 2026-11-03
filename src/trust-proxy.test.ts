import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { resolveTrustProxy } from "./trust-proxy.js";

test("trust proxy defaults: 1 hop on Render, off elsewhere; explicit override wins", () => {
  assert.equal(resolveTrustProxy({}), false);
  assert.equal(resolveTrustProxy({ RENDER: "true" }), 1);
  assert.equal(resolveTrustProxy({ RENDER: "true", CONDUIT_TRUST_PROXY: "false" }), false);
  assert.equal(resolveTrustProxy({ CONDUIT_TRUST_PROXY: "0" }), false);
  assert.equal(resolveTrustProxy({ CONDUIT_TRUST_PROXY: "2" }), 2);
  for (const bad of ["true", "-1", "11", "abc", "1.5"]) assert.throws(() => resolveTrustProxy({ CONDUIT_TRUST_PROXY: bad }), bad);
});

async function ipFor(trust: number | false, xff?: string): Promise<string> {
  const app = express();
  app.set("trust proxy", trust);
  app.get("/ip", (req, res) => res.send(req.ip));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/ip", headers: xff ? { "X-Forwarded-For": xff } : {} }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b)); });
      req.on("error", reject); req.end();
    });
  } finally { server.close(); }
}

test("with 1 hop, req.ip is the client appended by the proxy; forged left entries are ignored", async () => {
  assert.equal(await ipFor(1, "6.6.6.6, 203.0.113.7"), "203.0.113.7");
  assert.equal(await ipFor(1, "203.0.113.7"), "203.0.113.7");
});

test("without trust proxy, X-Forwarded-For is ignored", async () => {
  assert.match(await ipFor(false, "203.0.113.7"), /127\.0\.0\.1/);
});
