import test from "node:test";
import assert from "node:assert/strict";
import { cursorCodec, cursorOrder } from "./pagination.js";

test("signed cursors reject tampering and unsigned input when secret is set", () => {
  const previous = process.env.CONDUIT_CURSOR_SECRET;
  process.env.CONDUIT_CURSOR_SECRET = "cursor-secret-16b";
  try {
    const payload = { version: 1 as const, collection: "tasks" as const, projectId: "p1", filters: { status: "open" }, order: cursorOrder("tasks"), sort: { time: "2026-01-01T00:00:00.000Z", id: "task_1" } };
    const cursor = cursorCodec.encode(payload);
    assert.equal(cursorCodec.decode(cursor, { collection: "tasks", projectId: "p1", filters: payload.filters }).sort.id, "task_1");
    const forged = Buffer.from(JSON.stringify({ ...payload, sort: { ...payload.sort, id: "task_other" } })).toString("base64url");
    assert.throws(() => cursorCodec.decode(forged, { collection: "tasks", projectId: "p1", filters: payload.filters }), /invalid_cursor/);
  } finally {
    if (previous === undefined) delete process.env.CONDUIT_CURSOR_SECRET;
    else process.env.CONDUIT_CURSOR_SECRET = previous;
  }
});

test("signed cursors verify regardless of key order and reject a copied MAC on a changed body", () => {
  const previous = process.env.CONDUIT_CURSOR_SECRET;
  process.env.CONDUIT_CURSOR_SECRET = "cursor-secret-16b";
  try {
    const payload = { version: 1 as const, collection: "tasks" as const, projectId: null, filters: { status: "open", agent: "a1" }, order: cursorOrder("tasks"), sort: { time: "2026-01-01T00:00:00.000Z", id: "task_1" } };
    const signed = JSON.parse(Buffer.from(cursorCodec.encode(payload), "base64url").toString("utf8"));
    assert.equal(typeof signed.mac, "string");
    // Same fields, different key order (top level and filters): still valid.
    const reordered = { mac: signed.mac, sort: signed.sort, order: signed.order, filters: { agent: "a1", status: "open" }, projectId: null, collection: "tasks", version: 1 };
    assert.equal(cursorCodec.decode(Buffer.from(JSON.stringify(reordered)).toString("base64url"), { collection: "tasks", filters: payload.filters }).sort.id, "task_1");
    // A genuine MAC moved onto a different position must fail.
    const moved = { ...signed, sort: { ...signed.sort, time: "2025-01-01T00:00:00.000Z" } };
    assert.throws(() => cursorCodec.decode(Buffer.from(JSON.stringify(moved)).toString("base64url"), { collection: "tasks", filters: payload.filters }), /invalid_cursor/);
    // Non-string MAC must fail closed, not throw a TypeError path.
    const weird = { ...signed, mac: 12345 };
    assert.throws(() => cursorCodec.decode(Buffer.from(JSON.stringify(weird)).toString("base64url"), { collection: "tasks", filters: payload.filters }), /invalid_cursor/);
  } finally {
    if (previous === undefined) delete process.env.CONDUIT_CURSOR_SECRET;
    else process.env.CONDUIT_CURSOR_SECRET = previous;
  }
});

test("a secret shorter than 16 characters is ignored (cursors stay unsigned)", () => {
  const previous = process.env.CONDUIT_CURSOR_SECRET;
  process.env.CONDUIT_CURSOR_SECRET = "short";
  try {
    const payload = { version: 1 as const, collection: "agents" as const, projectId: null, filters: {}, order: cursorOrder("agents"), sort: { time: "2026-01-01T00:00:00.000Z", id: "agent_1" } };
    const decoded = JSON.parse(Buffer.from(cursorCodec.encode(payload), "base64url").toString("utf8"));
    assert.equal(decoded.mac, undefined);
  } finally {
    if (previous === undefined) delete process.env.CONDUIT_CURSOR_SECRET;
    else process.env.CONDUIT_CURSOR_SECRET = previous;
  }
});
