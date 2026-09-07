import test from "node:test";
import assert from "node:assert/strict";
import {
  registerAgent, createProject, getProject, createTask, getTask, listTasks, claimTask, blockTask, releaseTask, completeTask, handoff, Task
} from "./store.js";

test("task lifecycle enforces registered-agent ownership", async () => {
  await registerAgent({ id: "agent-a", name: "Agent A" });
  await registerAgent({ id: "agent-b", name: "Agent B" });
  assert.equal(await createTask({ title: "invalid", createdBy: "unknown" }), null);
  const t = await createTask({ title: "smoke", createdBy: "agent-a" });
  assert.ok(t);
  assert.equal(await claimTask(t.id, "unknown"), null);
  const claimed = await claimTask(t.id, "agent-b");
  assert.ok(claimed);
  assert.equal(await completeTask(t.id, "agent-a"), null);
  const done = await completeTask(t.id, "agent-b");
  assert.ok(done);
  assert.equal(done.status, "completed");
});

test("task handoff requires the current claimant and registered target", async () => {
  await registerAgent({ id: "agent-c", name: "Agent C" });
  await registerAgent({ id: "agent-d", name: "Agent D" });
  const t = await createTask({ title: "handoff", createdBy: "agent-c" });
  assert.ok(t);
  const claimed = await claimTask(t.id, "agent-c");
  assert.ok(claimed);
  assert.equal(await handoff(t.id, "agent-d", "agent-c", "unauthorized"), null);
  assert.equal(await handoff(t.id, "agent-c", "unknown", "unregistered target"), null);
  const moved = await handoff(t.id, "agent-c", "agent-d", "valid");
  assert.ok(moved);
  assert.equal(moved.claimedBy, "agent-d");
});

test("task block and release lifecycle and getters", async () => {
  await registerAgent({ id: "agent-x", name: "Agent X" });
  const project = await createProject({ name: "Project Test Get", createdBy: "agent-x" });
  assert.ok(project);
  const fetchedProject = await getProject(project!.id);
  assert.equal(fetchedProject?.id, project!.id);
  assert.equal(await getProject("nonexistent"), null);

  const task = await createTask({ title: "blockable", createdBy: "agent-x", projectId: project!.id });
  assert.ok(task);
  const fetchedTask = await getTask(task!.id);
  assert.equal(fetchedTask?.id, task!.id);
  assert.equal(await getTask("nonexistent"), null);

  // Claim
  await claimTask(task!.id, "agent-x");

  // Block task
  const blocked = await blockTask(task!.id, "agent-x", "Waiting for API credentials");
  assert.ok(blocked);
  assert.equal(blocked.status, "blocked");

  // Task listing filter by status / claimedBy / createdBy
  const blockedList = await listTasks({ status: "blocked", claimedBy: "agent-x" });
  assert.equal(blockedList.length, 1);
  assert.equal(blockedList[0].id, task!.id);

  const createdByList = await listTasks({ createdBy: "agent-x" });
  assert.ok(createdByList.some((t: Task) => t.id === task!.id));

  // Release task back to open
  const released = await releaseTask(task!.id, "agent-x");
  assert.ok(released);
  assert.equal(released.status, "open");
  assert.equal(released.claimedBy, undefined);
});
