import test from "node:test";
import assert from "node:assert/strict";
import { archiveProject, createProject, createTask, listAgentsPage, listProjectsPage, listTasksPage, registerAgent } from "./store.js";

test("equal timestamps use id as the descending keyset tie breaker", async () => {
  const suffix = crypto.randomUUID();
  const low = await registerAgent({ id: `a-${suffix}`, name: "low" });
  const high = await registerAgent({ id: `z-${suffix}`, name: "high" });
  const lowTime = low!.createdAt;
  const highTime = high!.createdAt;
  low!.createdAt = "2099-01-01T00:00:00.000Z";
  high!.createdAt = low!.createdAt;
  const first = await listAgentsPage({ limit: 1 });
  assert.equal(first.items[0].id, high!.id);
  const second = await listAgentsPage({ limit: 1, cursor: first.nextCursor });
  assert.equal(second.items[0].id, low!.id);
  low!.createdAt = lowTime;
  high!.createdAt = highTime;
});

test("keyset pages traverse without duplicates and ignore newer inserts", async () => {
  const prefix = crypto.randomUUID();
  for (let i = 0; i < 5; i++) await registerAgent({ id: `${prefix}-${i}`, name: `agent ${i}` });
  const first = await listAgentsPage({ limit: 2 });
  assert.ok(first.nextCursor);
  const inserted = await registerAgent({ id: `${prefix}-new`, name: "newer agent" });
  inserted!.createdAt = "2099-01-01T00:00:00.000Z";
  const seen = new Set(first.items.map(row => row.id));
  let cursor: string | undefined = first.nextCursor;
  while (cursor) {
    const page = await listAgentsPage({ limit: 2, cursor });
    for (const row of page.items) assert.equal(seen.has(row.id), false, `duplicate ${row.id}`);
    page.items.forEach(row => seen.add(row.id));
    cursor = page.nextCursor;
  }
  assert.equal(seen.has(`${prefix}-new`), false);
});

test("cursor remains usable when its row is archived", async () => {
  const agentId = `archive-${crypto.randomUUID()}`;
  await registerAgent({ id: agentId, name: "archiver" });
  const older = await createProject({ name: "older", createdBy: agentId });
  const newest = await createProject({ name: "newest", createdBy: agentId });
  older!.createdAt = "2098-01-01T00:00:00.000Z";
  newest!.createdAt = "2099-01-01T00:00:00.000Z";
  const first = await listProjectsPage({ limit: 1 });
  assert.ok(first.nextCursor);
  assert.equal(first.items[0].id, newest!.id);
  await archiveProject(first.items[0].id, agentId);
  const second = await listProjectsPage({ limit: 1, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
});

test("cursor rejects task filter changes", async () => {
  const agentId = `filters-${crypto.randomUUID()}`;
  await registerAgent({ id: agentId, name: "creator" });
  await createTask({ title: "one", createdBy: agentId });
  await createTask({ title: "two", createdBy: agentId });
  const first = await listTasksPage({ createdBy: agentId, status: "open", limit: 1 });
  assert.ok(first.nextCursor);
  await assert.rejects(() => listTasksPage({ createdBy: agentId, status: "completed", limit: 1, cursor: first.nextCursor }), /invalid_cursor/);
});
