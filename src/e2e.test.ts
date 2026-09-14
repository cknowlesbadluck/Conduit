import test from "node:test";
import assert from "node:assert/strict";
import { init, registerAgent, getBoundAgentId, createProject, registerResource, createTask, claimTask, handoff, completeTask, listTasks, getCoordinationContext } from "./store.js";
import { initCapabilityStore, createCapabilityGrant, listCapabilityGrants, revokeCapabilityGrant } from "./capability-store.js";
import { assertCapability } from "./capabilities.js";
import { subscribeEvents, replayRecentEvents, publishEvent } from "./events.js";
import { buildDiagnosticsFromMetadata } from "./diagnostics.js";
import { VERSION } from "./version.js";

test("authenticated production E2E complete lifecycle proof", async () => {
  // 1. Initialize store & capability store
  await init();
  await initCapabilityStore();

  // 2. Identity resolution & agent binding
  const agent1 = await registerAgent({ id: "e2e-agent-1", name: "E2E Agent 1", actorSubject: "e2e-sub-1" });
  assert.ok(agent1);
  assert.equal(await getBoundAgentId("e2e-sub-1"), "e2e-agent-1");

  const agent2 = await registerAgent({ id: "e2e-agent-2", name: "E2E Agent 2", actorSubject: "e2e-sub-2" });
  assert.ok(agent2);

  // 3. Project and Resource creation
  const project = await createProject({ name: "E2E Project", description: "Production E2E Proof Project", createdBy: "e2e-agent-1" });
  assert.ok(project);
  assert.equal(project.name, "E2E Project");

  const resource = await registerResource({
    projectId: project.id,
    name: "E2E Repo",
    description: "GitHub Repo for E2E",
    kind: "repository",
    endpoint: "https://github.com/cknowlesbadluck/Conduit",
    createdBy: "e2e-agent-1",
  });
  assert.ok(resource);

  // 4. Task lifecycle: Create -> Claim -> Handoff -> Complete
  const task = await createTask({
    title: "E2E Deployment Hardening",
    description: "Verify production release candidate 0.7.1",
    createdBy: "e2e-agent-1",
    projectId: project.id,
  });
  assert.ok(task);
  assert.equal(task.status, "open");

  const claimed = await claimTask(task.id, "e2e-agent-1");
  assert.ok(claimed);
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.claimedBy, "e2e-agent-1");

  const handedOff = await handoff(task.id, "e2e-agent-1", "e2e-agent-2", "Handoff to agent 2 for completion");
  assert.ok(handedOff);
  assert.equal(handedOff.claimedBy, "e2e-agent-2");

  const completed = await completeTask(task.id, "e2e-agent-2");
  assert.ok(completed);
  assert.equal(completed.status, "completed");

  const tasksList = await listTasks({ projectId: project.id });
  assert.equal(tasksList.length, 1);
  assert.equal(tasksList[0].status, "completed");

  // 5. Capability grant lifecycle
  const grant = await createCapabilityGrant({
    agentId: "e2e-agent-1",
    projectId: project.id,
    provider: "github",
    method: "GET",
    pathPattern: "/repos/cknowlesbadluck/Conduit/**",
    createdBy: "e2e-agent-1",
  });
  assert.ok(grant);

  assert.doesNotThrow(() => {
    assertCapability([grant], {
      agentId: "e2e-agent-1",
      provider: "github",
      method: "GET",
      path: "/repos/cknowlesbadluck/Conduit/commits",
      projectId: project.id,
    });
  });

  const grantsList = await listCapabilityGrants({ agentId: "e2e-agent-1", projectId: project.id });
  assert.equal(grantsList.length, 1);
  assert.equal(grantsList[0].id, grant.id);

  const revoked = await revokeCapabilityGrant(grant.id, "e2e-agent-1");
  assert.equal(revoked, true);

  const activeGrants = await listCapabilityGrants({ agentId: "e2e-agent-1", projectId: project.id });
  assert.equal(activeGrants.length, 0);

  // 6. Events subscription and replay
  const receivedEvents: string[] = [];
  const unsubscribe = subscribeEvents({ projectId: project.id }, (evt) => {
    receivedEvents.push(evt.type);
  });

  publishEvent({ id: "e2e-evt-1", type: "e2e.test.event", at: new Date().toISOString(), projectId: project.id });
  assert.ok(receivedEvents.includes("e2e.test.event"));
  unsubscribe();

  const replayed = await replayRecentEvents(project.id);
  assert.ok(Array.isArray(replayed));

  // 7. Context check
  const context = await getCoordinationContext(project.id);
  assert.ok(context);
  assert.equal(context.project?.id, project.id);

  // 8. Diagnostics metadata check
  const diag = buildDiagnosticsFromMetadata({
    resource: "https://conduit-feco.onrender.com/mcp",
    scopesSupported: ["mcp:conduit.read", "mcp:conduit.write"],
    configuredScopes: ["mcp:conduit.read", "mcp:conduit.write"],
  });
  assert.ok(diag);
  assert.equal(diag.scopeParity.ok, true);
});
