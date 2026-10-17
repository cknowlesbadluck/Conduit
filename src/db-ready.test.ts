import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { checkPersistence, createPersistenceProbe } from "./db-ready.js";

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

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    pending,
    timers: {
      setTimeout: (fn: () => void) => { const id = next++; pending.set(id, fn); return id; },
      clearTimeout: (h: unknown) => { pending.delete(h as number); },
    },
  };
}

test("createPersistenceProbe: clears its timeout timer once the query settles (no leak)", async () => {
  const ft = fakeTimers();
  const probe = createPersistenceProbe(async () => undefined, 2000, ft.timers);
  assert.equal(await probe(), true);
  assert.equal(ft.pending.size, 0, "timer must be cleared on success");
  const failing = createPersistenceProbe(async () => { throw new Error("boom"); }, 2000, ft.timers);
  assert.equal(await failing(), false);
  assert.equal(ft.pending.size, 0, "timer must be cleared on failure");
});

test("createPersistenceProbe: concurrent probes share one in-flight query; next call starts fresh", async () => {
  const ft = fakeTimers();
  let calls = 0;
  let release!: () => void;
  const probe = createPersistenceProbe(() => { calls++; return new Promise<void>((r) => { release = r; }); }, 2000, ft.timers);
  const a = probe(); const b = probe(); const c = probe();
  assert.equal(a, b); assert.equal(b, c);
  assert.equal(calls, 1);
  assert.equal(ft.pending.size, 1, "only one timer for the shared probe");
  release();
  assert.deepEqual(await Promise.all([a, b, c]), [true, true, true]);
  assert.equal(ft.pending.size, 0);
  const d = probe();
  assert.equal(calls, 2, "after settling, a new probe runs");
  release();
  assert.equal(await d, true);
});

test("createPersistenceProbe: timeout fails closed and releases the in-flight slot", async () => {
  const ft = fakeTimers();
  let calls = 0;
  const probe = createPersistenceProbe(() => { calls++; return new Promise(() => {}); }, 2000, ft.timers);
  const a = probe();
  assert.equal(ft.pending.size, 1);
  for (const fire of [...ft.pending.values()]) fire();
  assert.equal(await a, false);
  void probe();
  assert.equal(calls, 2, "a timed-out probe must not wedge future probes");
});
