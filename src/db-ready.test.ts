import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { checkPersistence } from "./db-ready.js";

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return fn().finally(() => { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } });
}

test("checkPersistence: memory mode is always ready (no DB contacted)", () =>
  withEnv({ CONDUIT_TEST_MEMORY: "true", DATABASE_URL: "postgres://u:p@127.0.0.1:1/db" }, async () => {
    assert.equal(await checkPersistence(), true);
  }));

test("checkPersistence: no DATABASE_URL means persistence is not configured, so ready", () =>
  withEnv({ CONDUIT_TEST_MEMORY: undefined, DATABASE_URL: undefined }, async () => {
    assert.equal(await checkPersistence(), true);
  }));

test("checkPersistence: an unresponsive database fails closed (false) within the probe timeout", async () => {
  // A TCP server that accepts and never speaks the Postgres protocol: the probe must time out, not hang.
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => { sockets.add(s); s.on("error", () => {}); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as net.AddressInfo;
  try {
    await withEnv({ CONDUIT_TEST_MEMORY: undefined, DATABASE_SSL: "false", DATABASE_URL: `postgres://u:p@127.0.0.1:${port}/db` }, async () => {
      const started = Date.now();
      assert.equal(await checkPersistence(), false);
      assert.ok(Date.now() - started < 5000, "probe must be bounded");
    });
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
