import test from "node:test";
import assert from "node:assert/strict";
import { initCapabilityStore, createCapabilityGrant, listCapabilityGrants, revokeCapabilityGrant, getCapabilityGrantsForAgent } from "./capability-store.js";
import { registerAgent, createProject } from "./store.js";

process.env.CONDUIT_TEST_MEMORY = "true";

test("capability store creates, lists, and revokes grants", async () => {
  await registerAgent({ id: "agent_1", name: "Agent One" });
  await initCapabilityStore();
  const created = await createCapabilityGrant({ agentId: "agent_1", provider: "github", method: "GET", pathPattern: "/repos/cknowlesbadluck/Conduit/**", createdBy: "agent_1" });
  assert.equal(created.agentId, "agent_1");
  assert.equal((await listCapabilityGrants({ agentId: "agent_1" })).length, 1);
  assert.equal(await revokeCapabilityGrant(created.id, "agent_1"), true);
  assert.equal((await listCapabilityGrants({ agentId: "agent_1", includeRevoked: true }))[0].revokedAt !== undefined, true);
});

test("capability store refuses grants that are already expired", async () => {
  await registerAgent({ id: "agent_exp", name: "Agent Exp" });
  await initCapabilityStore();
  await assert.rejects(
    createCapabilityGrant({ agentId: "agent_exp", provider: "github", method: "GET", pathPattern: "/repos/x/**", expiresAt: new Date(Date.now() - 1000).toISOString(), createdBy: "agent_exp" }),
    /expiry_in_past/,
  );
  const future = await createCapabilityGrant({ agentId: "agent_exp", provider: "github", method: "GET", pathPattern: "/repos/x/**", expiresAt: new Date(Date.now() + 60_000).toISOString(), createdBy: "agent_exp" });
  assert.ok(future.expiresAt);
});

const sfx = Math.random().toString(36).slice(2, 8);

test("createCapabilityGrant validates agents, project and expiry; uppercases method", async () => {
  const a = `cs-a-${sfx}`;
  await registerAgent({ id: a, name: a });
  await assert.rejects(() => createCapabilityGrant({ agentId: `ghost-${sfx}`, provider: "github", method: "GET", pathPattern: "/", createdBy: a }), /agent_unregistered/);
  await assert.rejects(() => createCapabilityGrant({ agentId: a, provider: "github", method: "GET", pathPattern: "/", createdBy: `ghost-${sfx}` }), /agent_unregistered/);
  await assert.rejects(() => createCapabilityGrant({ agentId: a, projectId: `nope-${sfx}`, provider: "github", method: "GET", pathPattern: "/", createdBy: a }), /project_not_found/);
  await assert.rejects(() => createCapabilityGrant({ agentId: a, provider: "github", method: "GET", pathPattern: "/", expiresAt: "not-a-date", createdBy: a }), /invalid_expiry/);
  const g = await createCapabilityGrant({ agentId: a, provider: "render", method: "post", pathPattern: "/services/*", expiresAt: "2099-01-01T00:00:00.000Z", createdBy: a });
  assert.equal(g.method, "POST");
  assert.match(g.id, /^grant_/);
  assert.equal(g.expiresAt, "2099-01-01T00:00:00.000Z");
  assert.ok(Number.isFinite(Date.parse(g.createdAt)));
});

test("listCapabilityGrants filters by agent, project (global grants included), provider and revoked", async () => {
  const a = `cs-l-${sfx}`, b = `cs-m-${sfx}`;
  await registerAgent({ id: a, name: a });
  await registerAgent({ id: b, name: b });
  const p1 = await createProject({ name: `cs-p1-${sfx}`, createdBy: a });
  const p2 = await createProject({ name: `cs-p2-${sfx}`, createdBy: a });
  assert.ok(p1 && p2);
  const global = await createCapabilityGrant({ agentId: a, provider: "github", method: "GET", pathPattern: "/g", createdBy: a });
  const inP1 = await createCapabilityGrant({ agentId: a, projectId: p1.id, provider: "supabase", method: "GET", pathPattern: "/p1", createdBy: a });
  const inP2 = await createCapabilityGrant({ agentId: a, projectId: p2.id, provider: "github", method: "GET", pathPattern: "/p2", createdBy: a });
  const other = await createCapabilityGrant({ agentId: b, provider: "github", method: "GET", pathPattern: "/b", createdBy: a });
  const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).sort();

  assert.deepEqual(ids(await listCapabilityGrants({ agentId: a })), ids([global, inP1, inP2]));
  assert.deepEqual(ids(await listCapabilityGrants({ agentId: a, projectId: p1.id })), ids([global, inP1]));
  assert.deepEqual(ids(await listCapabilityGrants({ agentId: a, provider: "github" })), ids([global, inP2]));
  assert.deepEqual(ids(await listCapabilityGrants({ agentId: b })), ids([other]));
  const all = await listCapabilityGrants();
  for (const g of [global, inP1, inP2, other]) assert.ok(all.some((x) => x.id === g.id));
  const listed = await listCapabilityGrants({ agentId: a });
  assert.ok(listed.every((x, i) => i === 0 || listed[i - 1].createdAt >= x.createdAt), "newest first");

  assert.equal(await revokeCapabilityGrant(inP2.id, a), true);
  assert.equal(await revokeCapabilityGrant(inP2.id, a), true, "revoke is idempotent for the creator");
  assert.deepEqual(ids(await listCapabilityGrants({ agentId: a })), ids([global, inP1]));
  const withRevoked = await listCapabilityGrants({ agentId: a, includeRevoked: true });
  assert.ok(withRevoked.find((x) => x.id === inP2.id)?.revokedAt);
  assert.deepEqual(await getCapabilityGrantsForAgent(a, p1.id).then(ids), ids([global, inP1]));
});

test("revokeCapabilityGrant refuses unknown ids and non-creators", async () => {
  const a = `cs-r-${sfx}`, b = `cs-s-${sfx}`;
  await registerAgent({ id: a, name: a });
  await registerAgent({ id: b, name: b });
  const g = await createCapabilityGrant({ agentId: b, provider: "mcp_bridge", method: "GET", pathPattern: "/t", createdBy: a });
  assert.equal(await revokeCapabilityGrant(`grant_missing_${sfx}`, a), false);
  assert.equal(await revokeCapabilityGrant(g.id, b), false, "grantee is not the creator");
  assert.equal((await listCapabilityGrants({ agentId: b })).some((x) => x.id === g.id), true);
});
