import test from "node:test";
import assert from "node:assert/strict";
import { initCapabilityStore, createCapabilityGrant, listCapabilityGrants, revokeCapabilityGrant } from "./capability-store.js";
import { registerAgent } from "./store.js";

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
