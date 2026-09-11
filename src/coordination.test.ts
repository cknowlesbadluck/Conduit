import test from "node:test";
import assert from "node:assert/strict";
import { registerAgent, getBoundAgentId, createProject, listProjects, registerResource, listResources, createTask, getTask, claimTask, listTasks, addContact, listContacts, registerTool, listTools, listActivity, getCoordinationContext } from "./store.js";

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
  assert.equal((await listResources()).length, 2);
  assert.equal((await listProjects()).length, 2);
});

test("project-scoped records filter consistently", async () => {
  const projectA = (await listProjects()).find(p => p.name === "Project A")!;
  const projectB = (await listProjects()).find(p => p.name === "Project B")!;
  await createTask({ title: "Task A", createdBy: "coord-a", projectId: projectA.id });
  await createTask({ title: "Task B", createdBy: "coord-a", projectId: projectB.id });
  await addContact("Contact A", "a@example.test", "email", projectA.id, "coord-a");
  await addContact("Contact B", "b@example.test", "email", projectB.id, "coord-a");
  await registerTool("Tool A", "A tool", "https://example.test/a", projectA.id, "coord-a");
  await registerTool("Tool B", "B tool", "https://example.test/b", projectB.id, "coord-a");
  assert.deepEqual((await listTasks(undefined, projectA.id)).map(t => t.title), ["Task A"]);
  assert.deepEqual((await listContacts(projectB.id)).map(c => c.name), ["Contact B"]);
  assert.deepEqual((await listTools(projectA.id)).map(t => t.name), ["Tool A"]);
  assert.ok((await listActivity(50, projectA.id)).every(e => e.projectId === projectA.id));
  const context = await getCoordinationContext(projectA.id);
  assert.ok(context);
  const scoped = context!;
  assert.equal(scoped.project!.id, projectA.id);
  assert.ok(scoped.tasks.every(t => t.projectId === projectA.id));
  assert.ok(scoped.resources.every(r => r.projectId === projectA.id));
  assert.ok(scoped.contacts.every(c => c.projectId === projectA.id));
  assert.ok(scoped.tools.every(t => t.projectId === projectA.id));
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
  assert.equal(await createTask({ title: "bad", createdBy: "coord-a", projectId: "project_missing" }), null);
  assert.equal(await registerResource({ projectId: "project_missing", name: "Bad", description: "Bad", kind: "external", createdBy: "coord-a" }), null);
  assert.equal(await addContact("Bad", "bad", "reference", "project_missing", "coord-a"), null);
  assert.equal(await registerTool("Bad", "Bad", undefined, "project_missing", "coord-a"), null);
  assert.equal(await getCoordinationContext("project_missing"), null);
});

test("getTask retrieves tasks by ID and reflects state changes", async () => {
  await registerAgent({ id: "gettask-agent", name: "GetTask Agent" });
  const created = await createTask({ title: "Task for getTask", description: "Testing getTask functionality", createdBy: "gettask-agent" });
  assert.ok(created);

  // Verify fetching existing task by ID
  const fetched = await getTask(created!.id);
  assert.ok(fetched);
  assert.equal(fetched!.id, created!.id);
  assert.equal(fetched!.title, "Task for getTask");
  assert.equal(fetched!.description, "Testing getTask functionality");
  assert.equal(fetched!.status, "open");
  assert.equal(fetched!.createdBy, "gettask-agent");
  assert.equal(fetched!.claimedBy, undefined);
  assert.ok(fetched!.createdAt);
  assert.ok(fetched!.updatedAt);

  // Verify non-existent task returns null
  const nonExistent = await getTask("non_existent_task_id");
  assert.equal(nonExistent, null);

  // Verify task state updates are reflected when re-fetched via getTask
  const claimed = await claimTask(created!.id, "gettask-agent");
  assert.ok(claimed);
  const refetched = await getTask(created!.id);
  assert.ok(refetched);
  assert.equal(refetched!.status, "claimed");
  assert.equal(refetched!.claimedBy, "gettask-agent");
});
