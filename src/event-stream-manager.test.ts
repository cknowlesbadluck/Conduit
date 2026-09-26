import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { EVENT_STREAM_CAPACITY_ERROR, EventStreamManager } from "./event-stream-manager.js";

class TestResponse extends EventEmitter {
  writableEnded = false;
  chunks: string[] = [];
  write(chunk: string) { this.chunks.push(chunk); return true; }
  end() { this.writableEnded = true; this.emit("close"); return this; }
}

test("reserves capacity before headers and exposes a stable exhaustion payload", () => {
  const manager = new EventStreamManager(1);
  const first = manager.admit(new EventEmitter(), new TestResponse());
  assert.ok(first);
  assert.equal(manager.activeCount, 1);
  assert.equal(manager.admit(new EventEmitter(), new TestResponse()), null);
  assert.deepEqual(EVENT_STREAM_CAPACITY_ERROR, { error: "event_stream_capacity_exhausted" });
  first.cleanup();
});

test("client disconnect releases its event-stream slot and resources", () => {
  const manager = new EventStreamManager(1);
  const request = new EventEmitter();
  const admission = manager.admit(request, new TestResponse());
  assert.ok(admission);
  let releases = 0;
  admission.addCleanup(() => { releases += 1; });

  request.emit("close");

  assert.equal(releases, 1);
  assert.equal(manager.activeCount, 0);
  assert.ok(manager.admit(new EventEmitter(), new TestResponse()));
});

test("cleanup is idempotent when multiple terminal events race", () => {
  const manager = new EventStreamManager();
  const request = new EventEmitter();
  const response = new TestResponse();
  const admission = manager.admit(request, response);
  assert.ok(admission);
  let releases = 0;
  admission.addCleanup(() => { releases += 1; });

  admission.cleanup();
  admission.cleanup();
  request.emit("error", new Error("late request error"));
  response.emit("close");

  assert.equal(releases, 1);
  assert.equal(manager.activeCount, 0);
});

test("shutdown rejects admissions, notifies and closes an open event stream", () => {
  const manager = new EventStreamManager();
  const response = new TestResponse();
  const admission = manager.admit(new EventEmitter(), response);
  assert.ok(admission);
  let releases = 0;
  admission.addCleanup(() => { releases += 1; });

  manager.shutdown(5000);

  assert.equal(manager.isAccepting, false);
  assert.equal(manager.activeCount, 0);
  assert.equal(releases, 1);
  assert.equal(response.writableEnded, true);
  assert.match(response.chunks.join(""), /retry: 5000/);
  assert.match(response.chunks.join(""), /event: shutdown/);
  assert.equal(manager.admit(new EventEmitter(), new TestResponse()), null);
});
