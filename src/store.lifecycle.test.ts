import test from "node:test";
import assert from "node:assert/strict";
import {
  registerAgent,
  createProject,
  createTask,
  getProject,
  getTask,
  claimTask,
  blockTask,
  releaseTask,
  completeTask,
  handoff,
  listAgents,
} from "./store.js";

test("getProject and getTask return records or null", async () => {
  await registerAgent({ id: "life-a", name: "Life A", actorSubject: "life-a-sub" });
  const project = await createProject({ name: "Lifecycle", createdBy: "life-a" });
  assert.ok(project);
  const found = await getProject(project!.id);
  assert.equal(found?.id, project!.id);
  assert.equal(await getProject("project_missing"), null);

  const task = await createTask({ title: "Lifecycle task", createdBy: "life-a", projectId: project!.id });
  assert.ok(task);
  const fetched = await getTask(task!.id);
  assert.equal(fetched?.id, task!.id);
  assert.equal(fetched?.status, "open");
  assert.equal(await getTask("task_missing"), null);
});

test("task lifecycle enforces ownership and legal transitions", async () => {
  await registerAgent({ id: "life-b", name: "Life B", actorSubject: "life-b-sub" });
  const agents = await listAgents();
  assert.ok(agents.some((agent) => agent.id === "life-a"));

  const project = await createProject({ name: "Lifecycle 2", createdBy: "life-a" });
  const task = await createTask({ title: "Owned work", createdBy: "life-a", projectId: project!.id });
  assert.ok(task);

  assert.equal(await claimTask(task!.id, "missing-agent"), null);
  assert.equal(await completeTask(task!.id, "life-a"), null);
  assert.equal(await blockTask(task!.id, "life-a"), null);

  const claimed = await claimTask(task!.id, "life-a");
  assert.equal(claimed?.status, "claimed");
  assert.equal(claimed?.claimedBy, "life-a");
  assert.equal(await claimTask(task!.id, "life-b"), null);

  const blocked = await blockTask(task!.id, "life-b", "not owner");
  assert.equal(blocked, null);
  const blockedOk = await blockTask(task!.id, "life-a", "waiting");
  assert.equal(blockedOk?.status, "blocked");

  assert.equal(await completeTask(task!.id, "life-a"), null);
  const released = await releaseTask(task!.id, "life-a");
  assert.equal(released?.status, "open");
  assert.equal(released?.claimedBy, undefined);

  const claimedAgain = await claimTask(task!.id, "life-a");
  assert.equal(claimedAgain?.status, "claimed");

  assert.equal(await handoff(task!.id, "life-a", "life-a"), null);
  const handed = await handoff(task!.id, "life-a", "life-b", "take it");
  assert.equal(handed?.claimedBy, "life-b");
  assert.equal((handed as { handoffNote?: string } | null)?.handoffNote, "take it");

  assert.equal(await completeTask(task!.id, "life-a"), null);
  const completed = await completeTask(task!.id, "life-b");
  assert.equal(completed?.status, "completed");
  assert.equal(await releaseTask(task!.id, "life-b"), null);
});
