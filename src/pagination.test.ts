import test from "node:test";
import assert from "node:assert/strict";
import { cursorCodec, cursorOrder, pageLimit } from "./pagination.js";

test("cursor codec round trips an explicitly ordered keyset", () => {
  const payload = { version: 1 as const, collection: "tasks" as const, projectId: "p1", filters: { status: "open" }, order: cursorOrder("tasks"), sort: { time: "2026-01-01T00:00:00.000Z", id: "task_1" } };
  const cursor = cursorCodec.encode(payload);
  assert.deepEqual(cursorCodec.decode(cursor, { collection: "tasks", projectId: "p1", filters: { status: "open" } }), payload);
});

test("cursor codec rejects collection, project, filter, ordering, and version changes", () => {
  const payload = { version: 1 as const, collection: "tasks" as const, projectId: "p1", filters: { status: "open" }, order: cursorOrder("tasks"), sort: { time: "2026-01-01T00:00:00.000Z", id: "task_1" } };
  const cursor = cursorCodec.encode(payload);
  assert.throws(() => cursorCodec.decode(cursor, { collection: "agents" }), /invalid_cursor/);
  assert.throws(() => cursorCodec.decode(cursor, { collection: "tasks", projectId: "p2", filters: payload.filters }), /invalid_cursor/);
  assert.throws(() => cursorCodec.decode(cursor, { collection: "tasks", projectId: "p1", filters: { status: "completed" } }), /invalid_cursor/);
  for (const change of [{ ...payload, version: 2 }, { ...payload, order: { ...payload.order, direction: "asc" } }]) {
    assert.throws(() => cursorCodec.decode(Buffer.from(JSON.stringify(change)).toString("base64url"), { collection: "tasks", projectId: "p1", filters: payload.filters }), /invalid_cursor/);
  }
});

test("page limits are bounded", () => {
  assert.equal(pageLimit(9999, 2), 2);
  assert.equal(pageLimit(0), 1);
});
