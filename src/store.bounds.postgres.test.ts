import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const postgres = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";

test("PostgreSQL activity prune keeps exactly the newest N rows (ties broken by id) without OFFSET deletes", { skip: !postgres }, async () => {
  process.env.CONDUIT_ACTIVITY_RETENTION = "200"; // read at module load, so set before importing store
  const { init, pruneActivity, listAgents, existingAgentIds, registerAgent } = await import("./store.js");
  const { closeSharedPool } = await import("./db-pool.js");
  await init();
  const client = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" }, max: 1 });
  try {
    const suffix = crypto.randomUUID();
    // 150 rows in the future and 100 tied rows in the past, so the boundary can land inside a tie group.
    await client.query(`INSERT INTO activity(id,type,at,data) SELECT 'bounds-new-${suffix}-' || lpad(g::text, 4, '0'), 'test', '2099-01-01T00:00:00.123456Z', '{}' FROM generate_series(1,150) g`);
    await client.query(`INSERT INTO activity(id,type,at,data) SELECT 'bounds-old-${suffix}-' || lpad(g::text, 4, '0'), 'test', '1999-01-01T00:00:00.654321Z', '{}' FROM generate_series(1,100) g`);
    const expected = new Set(((await client.query("SELECT id FROM activity ORDER BY at DESC, id DESC LIMIT 200")).rows as { id: string }[]).map((r) => r.id));
    const before = Number((await client.query("SELECT COUNT(*)::int AS n FROM activity")).rows[0].n);
    const deleted = await pruneActivity();
    assert.equal(deleted, before - 200);
    const kept = new Set(((await client.query("SELECT id FROM activity")).rows as { id: string }[]).map((r) => r.id));
    assert.deepEqual([...kept].sort(), [...expected].sort());
    assert.equal(await pruneActivity(), 0, "idempotent once within the window");

    const ids = [`bounds-agent-${suffix}-a`, `bounds-agent-${suffix}-b`];
    for (const agentId of ids) await registerAgent({ id: agentId, name: agentId });
    assert.equal((await listAgents(1)).length, 1);
    assert.deepEqual([...(await existingAgentIds([...ids, "nope"]))].sort(), ids);

    const { createCapabilityGrant, revokeCapabilityGrant, getEnforceableGrants } = await import("./capability-store.js");
    const { createProject } = await import("./store.js");
    const [a] = ids;
    const project = (await createProject({ name: `bounds-p-${suffix}`, createdBy: a }))!;
    const mk = (extra: Record<string, unknown>) => createCapabilityGrant({ agentId: a, provider: "github", method: "GET", pathPattern: "/repos/**", createdBy: a, ...extra } as Parameters<typeof createCapabilityGrant>[0]);
    const unscoped = await mk({}); const scoped = await mk({ projectId: project.id }); const expiring = await mk({ expiresAt: "2099-01-01T00:00:00.000Z" });
    const render = await mk({ provider: "render" }); const revoked = await mk({});
    await revokeCapabilityGrant(revoked.id, a);
    const got = (list: { id: string }[]) => list.map((x) => x.id).sort();
    assert.deepEqual(got(await getEnforceableGrants(a, "github", project.id)), [unscoped.id, scoped.id, expiring.id].sort());
    assert.deepEqual(got(await getEnforceableGrants(a, "github")), [unscoped.id, expiring.id].sort());
    assert.deepEqual(got(await getEnforceableGrants(a, "github", project.id, Date.parse("2100-01-01T00:00:00Z"))), [unscoped.id, scoped.id].sort());
    assert.deepEqual(got(await getEnforceableGrants(a, "render")), [render.id]);
  } finally {
    await client.end();
    await closeSharedPool();
  }
});
