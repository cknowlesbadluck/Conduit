import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POOL_MAX, databaseConfigured, getSharedPool, poolConfig, poolMax, sslOption } from "./db-pool.js";
import { AGENT_LIST_MAX, ACTIVITY_PRUNE_BATCH_SQL, ACTIVITY_PRUNE_BOUNDARY_SQL, agentListLimit, existingAgentIds, listAgents, pruneActivity, registerAgent } from "./store.js";

const memory = process.env.CONDUIT_TEST_MEMORY === "true";

test("db-pool: memory mode never creates a pool; config is explicit and clamped", () => {
  assert.equal(databaseConfigured({ DATABASE_URL: "postgres://x", CONDUIT_TEST_MEMORY: "true" }), false);
  assert.equal(databaseConfigured({}), false);
  assert.equal(databaseConfigured({ DATABASE_URL: "postgres://x" }), true);
  if (memory) assert.equal(getSharedPool(), null);
  assert.equal(poolMax({}), DEFAULT_POOL_MAX);
  assert.equal(poolMax({ DATABASE_POOL_MAX: "nope" }), DEFAULT_POOL_MAX);
  assert.equal(poolMax({ DATABASE_POOL_MAX: "0" }), 1);
  assert.equal(poolMax({ DATABASE_POOL_MAX: "999" }), 50);
  assert.equal(poolMax({ DATABASE_POOL_MAX: "4.9" }), 4);
});

test("db-pool: TLS default is unchanged (encrypted, verification opt-in), DATABASE_SSL=false disables", () => {
  assert.deepEqual(sslOption({}), { rejectUnauthorized: false });
  assert.deepEqual(sslOption({ DATABASE_SSL_REJECT_UNAUTHORIZED: "true" }), { rejectUnauthorized: true });
  assert.equal(sslOption({ DATABASE_SSL: "false" }), false);
  const config = poolConfig({ DATABASE_URL: "postgres://u@h/db", DATABASE_POOL_MAX: "7" });
  assert.equal(config.max, 7);
  assert.equal(config.connectionString, "postgres://u@h/db");
  assert.ok((config.connectionTimeoutMillis ?? 0) >= 1000, "connect timeout always set");
});

test("listAgents: bounded by default and by explicit limit, newest first", { skip: !memory }, async () => {
  assert.equal(agentListLimit(), 500);
  assert.equal(agentListLimit(5), 5);
  assert.equal(agentListLimit(0), 1);
  assert.equal(agentListLimit(Number.NaN), 500);
  assert.equal(agentListLimit(10_000), AGENT_LIST_MAX);
  const prior = process.env.CONDUIT_AGENT_LIST_LIMIT;
  process.env.CONDUIT_AGENT_LIST_LIMIT = "3";
  try { assert.equal(agentListLimit(), 3); } finally { if (prior === undefined) delete process.env.CONDUIT_AGENT_LIST_LIMIT; else process.env.CONDUIT_AGENT_LIST_LIMIT = prior; }

  const suffix = crypto.randomUUID();
  for (let i = 0; i < 4; i++) {
    await registerAgent({ id: `bounds-${suffix}-${i}`, name: `bounds ${i}` });
    await new Promise((r) => setTimeout(r, 2));
  }
  const two = await listAgents(2);
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((a) => a.id), [`bounds-${suffix}-3`, `bounds-${suffix}-2`]);
  assert.ok((await listAgents()).length <= 500);
});

test("existingAgentIds: returns only registered ids, dedupes, empty input short-circuits", { skip: !memory }, async () => {
  const agentId = `exists-${crypto.randomUUID()}`;
  await registerAgent({ id: agentId, name: "exists" });
  assert.deepEqual([...(await existingAgentIds([agentId, agentId, "missing-agent"]))], [agentId]);
  assert.equal((await existingAgentIds([])).size, 0);
});

test("pruneActivity: no OFFSET in the DELETE; keyset boundary + bounded batches", async () => {
  assert.doesNotMatch(ACTIVITY_PRUNE_BATCH_SQL, /offset/i);
  assert.match(ACTIVITY_PRUNE_BATCH_SQL, /\(at, id\) <= \(\$1::timestamptz, \$2\)/);
  assert.match(ACTIVITY_PRUNE_BATCH_SQL, /LIMIT \$3/);
  assert.match(ACTIVITY_PRUNE_BOUNDARY_SQL, /ORDER BY at DESC, id DESC OFFSET \$1 LIMIT 1/);
  assert.match(ACTIVITY_PRUNE_BOUNDARY_SQL, /at::text/, "boundary keeps microsecond precision");
  if (memory) assert.equal(await pruneActivity(), 0, "memory mode trims on write instead");
});

test("getEnforceableGrants: only grants that could authorise the call, same decisions as before", { skip: !memory }, async () => {
  const { createCapabilityGrant, revokeCapabilityGrant, getCapabilityGrantsForAgent, getEnforceableGrants } = await import("./capability-store.js");
  const { createProject } = await import("./store.js");
  const { matchesCapability } = await import("./capabilities.js");
  const s = crypto.randomUUID().slice(0, 8);
  const a = `enf-a-${s}`; const b = `enf-b-${s}`;
  await registerAgent({ id: a, name: a }); await registerAgent({ id: b, name: b });
  const p1 = (await createProject({ name: `enf-p1-${s}`, createdBy: a }))!;
  const p2 = (await createProject({ name: `enf-p2-${s}`, createdBy: a }))!;
  const g = (extra: Partial<Parameters<typeof createCapabilityGrant>[0]>) => createCapabilityGrant({ agentId: a, provider: "github", method: "GET", pathPattern: "/repos/**", createdBy: a, ...extra });
  const unscoped = await g({});
  const inP1 = await g({ projectId: p1.id });
  const inP2 = await g({ projectId: p2.id });
  const otherProvider = await g({ provider: "render" });
  const expiring = await g({ expiresAt: "2099-01-01T00:00:00.000Z" });
  const revoked = await g({});
  await revokeCapabilityGrant(revoked.id, a);
  await createCapabilityGrant({ agentId: b, provider: "github", method: "GET", pathPattern: "/repos/**", createdBy: b });
  const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();

  assert.deepEqual(ids(await getEnforceableGrants(a, "github", p1.id)), ids([unscoped, inP1, expiring]));
  assert.deepEqual(ids(await getEnforceableGrants(a, "github")), ids([unscoped, expiring]), "no project: only unscoped grants can match");
  assert.deepEqual(ids(await getEnforceableGrants(a, "github", p1.id, Date.parse("2100-01-01T00:00:00Z"))), ids([unscoped, inP1]), "expired excluded");
  assert.deepEqual(ids(await getEnforceableGrants(a, "render")), ids([otherProvider]));
  assert.ok(!ids(await getEnforceableGrants(a, "github", p2.id)).includes(inP1.id));

  // Equivalence: for each request shape, a grant matches iff it was in the narrowed set or would never have matched.
  for (const projectId of [undefined, p1.id, p2.id]) {
    for (const provider of ["github", "render"] as const) {
      const request = { agentId: a, provider, method: "GET", path: "/repos/x/y", projectId };
      const before = (await getCapabilityGrantsForAgent(a, projectId)).filter((grant) => matchesCapability(grant, request)).map((x) => x.id).sort();
      const after = (await getEnforceableGrants(a, provider, projectId)).filter((grant) => matchesCapability(grant, request)).map((x) => x.id).sort();
      assert.deepEqual(after, before, `${provider} ${projectId ?? "unscoped"}`);
    }
  }
});
