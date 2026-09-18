import test from "node:test";
import assert from "node:assert/strict";
import { init, registerAgent, getBoundAgentId, createProject, listProjects, registerResource, listResources, createTask, listTasks, addContact, listContacts, registerTool, listTools, listActivity, getCoordinationContext, claimTask, handoff, archiveProject, archiveResource, getProject } from "./store.js";

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
