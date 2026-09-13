import test from "node:test";
import assert from "node:assert/strict";
import { initCapabilityStore, createCapabilityGrant, listCapabilityGrants, revokeCapabilityGrant } from "./capability-store.js";

process.env.CONDUIT_TEST_MEMORY = "true";

test("capability store creates, lists, and revokes grants", async () => {
  await initCapabilityStore();
  const created = await createCapabilityGrant({
    agentId: "agent_1",
    provider: "github",
    method: "GET",
    pathPattern: "/repos/cknowlesbadluck/Conduit/**",
    createdBy: "agent_1",
  });
  assert.equal(created.agentId, "agent_1");
  assert.equal((await listCapabilityGrants({ agentId: "agent_1" })).length, 1);
  assert.equal(await revokeCapabilityGrant(created.id, "agent_1"), true);
  assert.equal((await listCapabilityGrants({ agentId: "agent_1" }))[0].revokedAt !== undefined, true);
});
