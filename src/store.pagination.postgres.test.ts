import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { archiveResource, createProject, createTask, init, listResourcesPage, listTasksPage, registerAgent, registerResource } from "./store.js";

const postgres = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";

test("PostgreSQL keysets handle ties, concurrent inserts, archived cursor rows, filters, and complete traversal", { skip: !postgres }, async () => {
  await init();
  const client = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" } });
  const suffix = crypto.randomUUID();
  const agentId = `page-agent-${suffix}`;
  await registerAgent({ id: agentId, name: "pagination test" });
  const project = await createProject({ name: `page-project-${suffix}`, createdBy: agentId });
  assert.ok(project);
  const made = [];
  for (let i = 0; i < 5; i++) made.push((await createTask({ title: `page-${i}`, createdBy: agentId, projectId: project.id }))!);
  await client.query("UPDATE tasks SET created_at='2026-01-01T00:00:00.000Z' WHERE id = ANY($1)", [made.map(row => row.id)]);

  const first = await listTasksPage({ createdBy: agentId, projectId: project.id, limit: 2 });
  assert.deepEqual(first.items.map(row => row.id), [...made.map(row => row.id)].sort().reverse().slice(0, 2));
  const inserted = await createTask({ title: "inserted between pages", createdBy: agentId, projectId: project.id });
  await client.query("UPDATE tasks SET created_at='2027-01-01T00:00:00.000Z' WHERE id=$1", [inserted!.id]);
  await assert.rejects(() => listTasksPage({ createdBy: agentId, projectId: project.id, status: "completed", limit: 2, cursor: first.nextCursor }), /invalid_cursor/);

  const seen = new Set(first.items.map(row => row.id));
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await listTasksPage({ createdBy: agentId, projectId: project.id, limit: 2, cursor });
    for (const row of page.items) assert.equal(seen.has(row.id), false);
    page.items.forEach(row => seen.add(row.id));
    cursor = page.nextCursor;
  }
  assert.equal(seen.size, made.length);
  assert.equal(seen.has(inserted!.id), false);

  const resourceIds = [];
  for (let i = 0; i < 2; i++) resourceIds.push((await registerResource({ projectId: project.id, name: `resource-${i}`, description: "", kind: "test", createdBy: agentId }))!.id);
  await client.query("UPDATE resources SET created_at='2026-02-01T00:00:00.000Z' WHERE id = ANY($1)", [resourceIds]);
  const resourceFirst = await listResourcesPage({ projectId: project.id, limit: 1 });
  await archiveResource(resourceFirst.items[0].id, agentId);
  const resourceSecond = await listResourcesPage({ projectId: project.id, limit: 1, cursor: resourceFirst.nextCursor });
  assert.equal(resourceSecond.items.length, 1);

  await client.query("DELETE FROM activity WHERE data->>'agentId'=$1 OR project_id=$2", [agentId, project.id]);
  await client.query("DELETE FROM resources WHERE project_id=$1", [project.id]);
  await client.query("DELETE FROM tasks WHERE project_id=$1", [project.id]);
  await client.query("DELETE FROM projects WHERE id=$1", [project.id]);
  await client.query("DELETE FROM agents WHERE id=$1", [agentId]);
  await client.end();
});
