import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createEventStreamHandler, getSseStats, nextPollDelay, resetSseStatsForTests, type SseEvent } from "./sse.js";

type Timer = { fn: () => void; ms: number; id: number };

function fakeClock() {
  let seq = 0;
  const timers = new Map<number, Timer>();
  return {
    timers,
    schedule: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { fn, ms, id }); return id; },
    cancel: (handle: unknown) => { timers.delete(handle as number); },
    delays: () => [...timers.values()].map((timer) => timer.ms).sort((a, b) => a - b),
    async fire(ms: number) {
      for (const timer of [...timers.values()].filter((t) => t.ms === ms)) { timers.delete(timer.id); timer.fn(); }
      await flush();
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeRes extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  body: unknown;
  chunks: string[] = [];
  writableLength = 0;
  writableEnded = false;
  writeReturns = true;
  status(code: number) { this.statusCode = code; return this; }
  set(headers: Record<string, string>) { Object.assign(this.headers, headers); return this; }
  json(body: unknown) { this.body = body; this.writableEnded = true; return this; }
  flushHeaders() {}
  write(chunk: string) { this.chunks.push(chunk); return this.writeReturns; }
  end() { this.writableEnded = true; return this; }
  events() { return this.chunks.filter((c) => c.startsWith("id: ")).map((c) => c.split("\n")[0].slice(4)); }
}

function harness(replayResult: () => Promise<SseEvent[]> | SseEvent[], overrides: Record<string, unknown> = {}) {
  const clock = fakeClock();
  const listeners = new Set<(event: SseEvent) => void>();
  let replays = 0;
  const handler = createEventStreamHandler({
    replay: async () => { replays++; return replayResult(); },
    subscribe: (_filter, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    pollMinMs: 1000, pollMaxMs: 8000, heartbeatMs: 15000, maxBufferedBytes: 100,
    schedule: clock.schedule, cancel: clock.cancel, now: () => 42,
    ...overrides,
  });
  const req = new EventEmitter() as EventEmitter & { query: Record<string, unknown> };
  req.query = { projectId: "p1" };
  const res = new FakeRes();
  return { clock, listeners, handler, req, res, replays: () => replays, publish: (e: SseEvent) => { for (const l of listeners) l(e); } };
}

const ev = (id: string): SseEvent => ({ id, type: "task.created", projectId: "p1" });

test("nextPollDelay doubles while idle, caps at max, resets on progress", () => {
  assert.equal(nextPollDelay(1000, 0, 1000, 8000), 2000);
  assert.equal(nextPollDelay(4000, 0, 1000, 8000), 8000);
  assert.equal(nextPollDelay(8000, 0, 1000, 8000), 8000);
  assert.equal(nextPollDelay(8000, 3, 1000, 8000), 1000);
});

test("replays then streams live events once each, with SSE headers", async () => {
  resetSseStatsForTests();
  const h = harness(() => [ev("a"), ev("b")]);
  await h.handler(h.req, h.res);
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.res.headers["Content-Type"], "text/event-stream");
  h.publish(ev("b"));
  h.publish(ev("c"));
  assert.deepEqual(h.res.events(), ["a", "b", "c"]);
  assert.equal(getSseStats().active, 1);
  h.req.emit("close");
  assert.equal(getSseStats().active, 0);
  assert.equal(h.listeners.size, 0, "unsubscribed on close");
  assert.equal(h.clock.timers.size, 0, "no timers left behind");
});

test("idle polling is single-flight and backs off exponentially; new events reset it", async () => {
  let batch: SseEvent[] = [];
  const h = harness(() => batch);
  await h.handler(h.req, h.res);
  assert.deepEqual(h.clock.delays(), [1000, 15000]);
  await h.clock.fire(1000);
  assert.deepEqual(h.clock.delays(), [2000, 15000]);
  await h.clock.fire(2000);
  await h.clock.fire(4000);
  await h.clock.fire(8000);
  assert.deepEqual(h.clock.delays(), [8000, 15000], "capped at pollMaxMs");
  batch = [ev("x")];
  await h.clock.fire(8000);
  assert.deepEqual(h.clock.delays(), [1000, 15000], "progress resets backoff");
  assert.deepEqual(h.res.events(), ["x"]);
  h.req.emit("close");
});

test("a slow replay never overlaps itself (no timer is armed while a poll is in flight)", async () => {
  let release: (v: SseEvent[]) => void = () => {};
  let first = true;
  const h = harness(() => { if (first) { first = false; return []; } return new Promise<SseEvent[]>((resolve) => { release = resolve; }); });
  await h.handler(h.req, h.res);
  await h.clock.fire(1000);
  assert.deepEqual(h.clock.delays(), [15000], "poll timer not re-armed until the in-flight replay settles");
  assert.equal(h.replays(), 2);
  release([]);
  await flush();
  assert.deepEqual(h.clock.delays(), [2000, 15000]);
  h.req.emit("close");
});

test("poll errors are counted and keep the stream alive", async () => {
  resetSseStatsForTests();
  let fail = false;
  const h = harness(() => { if (fail) throw new Error("db down"); return []; });
  await h.handler(h.req, h.res);
  fail = true;
  await h.clock.fire(1000);
  assert.equal(getSseStats().pollErrors, 1);
  assert.deepEqual(h.clock.delays(), [2000, 15000]);
  h.req.emit("close");
});

test("backpressure: writes pause until drain; skipped events are re-sent by the next replay", async () => {
  resetSseStatsForTests();
  let batch: SseEvent[] = [];
  const h = harness(() => batch);
  await h.handler(h.req, h.res);
  h.res.writeReturns = false;
  h.publish(ev("1"));
  h.publish(ev("2"));
  assert.deepEqual(h.res.events(), ["1"], "second write held while socket is not draining");
  assert.equal(getSseStats().pausedWrites, 1);
  h.res.writeReturns = true;
  h.res.emit("drain");
  batch = [ev("1"), ev("2")];
  await h.clock.fire(1000);
  assert.deepEqual(h.res.events(), ["1", "2"], "held event recovered via replay, no duplicates");
  h.req.emit("close");
});

test("slow consumer over the buffer budget is disconnected and fully cleaned up", async () => {
  resetSseStatsForTests();
  const h = harness(() => []);
  await h.handler(h.req, h.res);
  h.res.writableLength = 101;
  h.publish(ev("big"));
  assert.equal(h.res.writableEnded, true);
  assert.equal(getSseStats().slowConsumerDisconnects, 1);
  assert.equal(getSseStats().active, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.clock.timers.size, 0);
});

test("heartbeat writes a comment frame and re-arms; skipped while paused", async () => {
  const h = harness(() => []);
  await h.handler(h.req, h.res);
  await h.clock.fire(15000);
  assert.ok(h.res.chunks.includes(": heartbeat 42\n\n"));
  const before = h.res.chunks.length;
  h.res.writeReturns = false;
  h.publish(ev("p"));
  await h.clock.fire(15000);
  assert.equal(h.res.chunks.length, before + 1, "only the event write; heartbeat skipped while paused");
  assert.ok(h.clock.delays().includes(15000));
  h.req.emit("close");
});

test("subscriber cap answers 503 + Retry-After before any stream bytes", async () => {
  resetSseStatsForTests();
  const clock = fakeClock();
  const handler = createEventStreamHandler({
    replay: async () => [],
    subscribe: () => { throw new Error("event_subscriber_limit_reached"); },
    schedule: clock.schedule, cancel: clock.cancel,
  });
  const req = Object.assign(new EventEmitter(), { query: {} });
  const res = new FakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["Retry-After"], "5");
  assert.deepEqual(res.body, { error: "event_subscriber_limit_reached" });
  assert.equal(res.chunks.length, 0);
  assert.equal(clock.timers.size, 0);
  assert.equal(getSseStats().rejectedAtCapacity, 1);
  assert.equal(getSseStats().active, 0);
});

test("unexpected subscribe errors still propagate", async () => {
  const handler = createEventStreamHandler({ replay: async () => [], subscribe: () => { throw new Error("boom"); } });
  await assert.rejects(handler(Object.assign(new EventEmitter(), { query: {} }), new FakeRes()), /boom/);
});

test("client disconnect during the initial replay leaves no timers or subscription", async () => {
  let release: (v: SseEvent[]) => void = () => {};
  const h = harness(() => new Promise<SseEvent[]>((resolve) => { release = resolve; }));
  const pending = h.handler(h.req, h.res);
  h.req.emit("close");
  release([ev("late")]);
  await pending;
  assert.equal(h.clock.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.res.events(), []);
});
