import test from "node:test";
import assert from "node:assert/strict";
import { init, registerAgent, getBoundAgentId, createProject, listProjects, registerResource, listResources, createTask, listTasks, addContact, listContacts, registerTool, listTools, listActivity, getCoordinationContext, claimTask, handoff } from "./store.js";

await init();

test("projects and resources are isolated by project", async () => {
  await registerAgent({ id: "coord-a", name: "Coordinator A", actorSubject: "subject-a" });
  const projectA = await createProject({ name: "Project A", createdBy: "coord-a" });
  const projectB = await createProject({ name: "Project B", createdBy: "coord-a" });
  assert.ok(projectA && projectB);
  await registerResource({ projectId: projectA!.id, name: "Repo A", description: "A repository", kind: "repository", endpoint: "https://github.com/example/a", createdBy: "coord-a" });
  await registerResource({ projectId: projectB!.id, name: "Repo B", description: "B repository", kind: "repository", endpoint: "https://github.com/example/b", createdBy: "coord-a" });
  const resourcesA = await listResources(projectA!.id);
  assert.equal(resourcesA.length, 1);
  assert.equal(resourcesA[0].name, "Repo A");
  const allResources = await listResources();
  assert.ok(allResources.some((r) => r.name === "Repo A" && r.projectId === projectA!.id));
  assert.ok(allResources.some((r) => r.name === "Repo B" && r.projectId === projectB!.id));
  const projects = await listProjects();
  assert.ok(projects.some((p) => p.id === projectA!.id));
  assert.ok(projects.some((p) => p.id === projectB!.id));
});

test("project-scoped records filter consistently", async () => {
  await registerAgent({ id: "coord-a", name: "Coordinator A", actorSubject: "subject-a" });
  const projectA = await createProject({ name: "Project A scoped", createdBy: "coord-a" });
  const projectB = await createProject({ name: "Project B scoped", createdBy: "coord-a" });
  assert.ok(projectA && projectB);
  await createTask({ title: "Task A", createdBy: "coord-a", projectId: projectA!.id });
  await createTask({ title: "Task B", createdBy: "coord-a", projectId: projectB!.id });
  await addContact("Contact A", "a@example.test", "email", projectA!.id, "coord-a");
  await addContact("Contact B", "b@example.test", "email", projectB!.id, "coord-a");
  await registerTool("Tool A", "A tool", "https://example.test/a", projectA!.id, "coord-a");
  await registerTool("Tool B", "B tool", "https://example.test/b", projectB!.id, "coord-a");
  assert.deepEqual((await listTasks(undefined, projectA!.id)).map(t => t.title), ["Task A"]);
  assert.deepEqual((await listContacts(projectB!.id)).map(c => c.name), ["Contact B"]);
  assert.deepEqual((await listTools(projectA!.id)).map(t => t.name), ["Tool A"]);
  assert.ok((await listActivity(50, projectA!.id)).every(e => e.projectId === projectA!.id));
  const context = await getCoordinationContext(projectA!.id);
  assert.ok(context);
  const scoped = context!;
  assert.equal(scoped.project!.id, projectA!.id);
  assert.ok(scoped.tasks.every(t => t.projectId === projectA!.id));
  assert.ok(scoped.resources.every(r => r.projectId === projectA!.id));
  assert.ok(scoped.contacts.every(c => c.projectId === projectA!.id));
  assert.ok(scoped.tools.every(t => t.projectId === projectA!.id));
});

test("authenticated actor binding prevents identity switching", async () => {
  await registerAgent({ id: "bound-a", name: "Bound A", actorSubject: "actor-a" });
  assert.equal(await getBoundAgentId("actor-a"), "bound-a");
  assert.equal(await registerAgent({ id: "bound-b", name: "Bound B", actorSubject: "actor-a" }), null);
  await registerAgent({ id: "bound-b", name: "Bound B", actorSubject: "actor-b" });
  assert.equal(await getBoundAgentId("actor-b"), "bound-b");
  assert.equal(await registerAgent({ id: "bound-b", name: "Bound B spoof", actorSubject: "actor-a" }), null);
});

test("unknown projects are rejected for project-scoped writes", async () => {
  await registerAgent({ id: "coord-a", name: "Coordinator A", actorSubject: "subject-a" });
  assert.equal(await createTask({ title: "bad", createdBy: "coord-a", projectId: "project_missing" }), null);
  assert.equal(await registerResource({ projectId: "project_missing", name: "Bad", description: "Bad", kind: "external", createdBy: "coord-a" }), null);
  assert.equal(await addContact("Bad", "bad", "reference", "project_missing", "coord-a"), null);
  assert.equal(await registerTool("Bad", "Bad", undefined, "project_missing", "coord-a"), null);
  assert.equal(await getCoordinationContext("project_missing"), null);
});

test("concurrent task claims allow exactly one winner", async () => {
  await registerAgent({ id: "claim-agent-1", name: "Claimer 1" });
  await registerAgent({ id: "claim-agent-2", name: "Claimer 2" });
  const task = await createTask({ title: "Concurrent Task", createdBy: "claim-agent-1" });
  assert.ok(task);

  const results = await Promise.all([
    claimTask(task.id, "claim-agent-1"),
    claimTask(task.id, "claim-agent-2"),
  ]);

  const winners = results.filter((r) => r !== null);
  assert.equal(winners.length, 1);
  assert.equal(winners[0]?.status, "claimed");
});

test("concurrent handoff requests allow exactly one successful handoff", async () => {
  await registerAgent({ id: "handoff-owner", name: "Handoff Owner" });
  await registerAgent({ id: "handoff-target-1", name: "Target 1" });
  await registerAgent({ id: "handoff-target-2", name: "Target 2" });

  const task = await createTask({ title: "Handoff Task", createdBy: "handoff-owner" });
  assert.ok(task);
  await claimTask(task.id, "handoff-owner");

  const results = await Promise.all([
    handoff(task.id, "handoff-owner", "handoff-target-1", "Handoff to 1"),
    handoff(task.id, "handoff-owner", "handoff-target-2", "Handoff to 2"),
  ]);

  const winners = results.filter((r) => r !== null);
  assert.equal(winners.length, 1);
});
