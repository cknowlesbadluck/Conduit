import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { claimTask, completeTask, createTask, getTask, init, reclaimStaleTask, registerAgent, taskHealth } from "./store.js";

const postgres = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";
const MIN = 60_000;

function adminPool() {
  return new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" } });
}

async function fixture(admin: pg.Pool, rescuers = 1) {
  const s = crypto.randomUUID().slice(0, 8);
  const holder = `pg-holder-${s}`;
  const others = Array.from({ length: rescuers }, (_, i) => `pg-rescuer-${i}-${s}`);
  for (const id of [holder, ...others]) await registerAgent({ id, name: id });
  const task = (await createTask({ title: `pg-reclaim-${s}`, createdBy: holder }))!;
  assert.ok(await claimTask(task.id, holder));
  const cleanup = async () => {
    await admin.query("DELETE FROM activity WHERE data->>'taskId'=$1", [task.id]);
    await admin.query("DELETE FROM tasks WHERE id=$1", [task.id]);
    await admin.query("DELETE FROM activity WHERE data->>'agentId' = ANY($1)", [[holder, ...others]]);
    await admin.query("DELETE FROM agents WHERE id = ANY($1)", [[holder, ...others]]);
  };
  return { holder, others, taskId: task.id, cleanup };
}

test("PostgreSQL reclaim: fresh claim protected; backdated updated_at reclaimed atomically with audit trail", { skip: !postgres }, async () => {
  await init();
  const admin = adminPool();
  const f = await fixture(admin);
  try {
    assert.equal(await reclaimStaleTask(f.taskId, f.others[0], 30 * MIN), null, "fresh claim must not be reclaimable");
    assert.equal(await reclaimStaleTask(f.taskId, f.holder, 1 * MIN), null, "holder cannot reclaim from itself");
    await admin.query("UPDATE tasks SET updated_at = now() - interval '31 minutes' WHERE id=$1", [f.taskId]);
    const health = await taskHealth(undefined, 30 * MIN);
    assert.ok(health.reclaimable >= 1, "backdated claim counted as reclaimable");
    const won = await reclaimStaleTask(f.taskId, f.others[0], 30 * MIN);
    assert.ok(won);
    assert.equal(won.previousAgentId, f.holder);
    assert.ok(won.idleMs >= 31 * MIN - 5_000);
    assert.equal(won.task.claimedBy, f.others[0]);
    const row = (await admin.query("SELECT claimed_by, status, updated_at > now() - interval '1 minute' AS fresh FROM tasks WHERE id=$1", [f.taskId])).rows[0];
    assert.deepEqual(row, { claimed_by: f.others[0], status: "claimed", fresh: true });
    const audit = (await admin.query("SELECT data FROM activity WHERE type='task.reclaim' AND data->>'taskId'=$1", [f.taskId])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].data.previousAgentId, f.holder);
    // The previous holder can no longer complete the task it lost.
    assert.equal(await completeTask(f.taskId, f.holder), null);
    assert.equal((await getTask(f.taskId))?.claimedBy, f.others[0]);
  } finally { await f.cleanup(); await admin.end(); }
});

test("PostgreSQL reclaim race: concurrent reclaimers produce exactly one winner and one audit row", { skip: !postgres }, async () => {
  await init();
  const admin = adminPool();
  const f = await fixture(admin, 6);
  try {
    await admin.query("UPDATE tasks SET updated_at = now() - interval '2 hours' WHERE id=$1", [f.taskId]);
    const results = await Promise.all(f.others.map(agent => reclaimStaleTask(f.taskId, agent, 60 * MIN)));
    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}`);
    const row = (await admin.query("SELECT claimed_by FROM tasks WHERE id=$1", [f.taskId])).rows[0];
    assert.equal(row.claimed_by, winners[0]!.task.claimedBy);
    const audit = await admin.query("SELECT count(*)::int AS n FROM activity WHERE type='task.reclaim' AND data->>'taskId'=$1", [f.taskId]);
    assert.equal(audit.rows[0].n, 1);
  } finally { await f.cleanup(); await admin.end(); }
});

test("PostgreSQL reclaim vs holder completion race: never both succeed", { skip: !postgres }, async () => {
  await init();
  const admin = adminPool();
  const f = await fixture(admin);
  try {
    await admin.query("UPDATE tasks SET updated_at = now() - interval '2 hours' WHERE id=$1", [f.taskId]);
    const [done, taken] = await Promise.all([completeTask(f.taskId, f.holder), reclaimStaleTask(f.taskId, f.others[0], 60 * MIN)]);
    assert.ok(Boolean(done) !== Boolean(taken), "exactly one of complete/reclaim must win");
    const row = (await admin.query("SELECT status, claimed_by FROM tasks WHERE id=$1", [f.taskId])).rows[0];
    if (done) assert.equal(row.status, "completed");
    else assert.deepEqual(row, { status: "claimed", claimed_by: f.others[0] });
  } finally { await f.cleanup(); await admin.end(); }
});
