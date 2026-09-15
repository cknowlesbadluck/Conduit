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
  listActivity,
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

test("blockTask updates task status, logs activity event, and rejects invalid calls", async () => {
  await registerAgent({ id: "block-a1", name: "Block Agent 1" });
  await registerAgent({ id: "block-a2", name: "Block Agent 2" });

  const project = await createProject({ name: "Block Test Project", createdBy: "block-a1" });
  assert.ok(project);

  const task = await createTask({ title: "Task to block", createdBy: "block-a1", projectId: project.id });
  assert.ok(task);

  // 1. Unregistered agent
  assert.equal(await blockTask(task.id, "unregistered-agent", "reason"), null);

  // 2. Non-existent task
  assert.equal(await blockTask("missing-task-id", "block-a1", "reason"), null);

  // 3. Unclaimed task (open status)
  assert.equal(await blockTask(task.id, "block-a1", "reason"), null);

  // Claim task
  const claimed = await claimTask(task.id, "block-a1");
  assert.ok(claimed);
  assert.equal(claimed.status, "claimed");

  // 4. Attempt to block by non-claimant agent
  assert.equal(await blockTask(task.id, "block-a2", "not claimant"), null);

  // 5. Successful blockTask call with reason
  const blockedWithReason = await blockTask(task.id, "block-a1", "Waiting for dependency");
  assert.ok(blockedWithReason);
  assert.equal(blockedWithReason.status, "blocked");
  assert.equal(blockedWithReason.claimedBy, "block-a1");

  // Check activity log for event with reason
  const activity1 = await listActivity(50, project.id);
  const blockEvent1 = activity1.find(e => e.type === "task.block" && e.taskId === task.id);
  assert.ok(blockEvent1);
  assert.equal(blockEvent1.agentId, "block-a1");
  assert.equal(blockEvent1.reason, "Waiting for dependency");
  assert.equal(blockEvent1.projectId, project.id);

  // 6. Attempting to block an already blocked task returns null
  assert.equal(await blockTask(task.id, "block-a1", "already blocked"), null);

  // Release and re-claim task to test blockTask without reason
  const released = await releaseTask(task.id, "block-a1");
  assert.ok(released);
  const claimedAgain = await claimTask(task.id, "block-a1");
  assert.ok(claimedAgain);

  // 7. Successful blockTask call without reason
  const blockedNoReason = await blockTask(task.id, "block-a1");
  assert.ok(blockedNoReason);
  assert.equal(blockedNoReason.status, "blocked");

  // Check activity log for event without reason
  const activity2 = await listActivity(50, project.id);
  const blockEvents = activity2.filter(e => e.type === "task.block" && e.taskId === task.id);
  assert.equal(blockEvents.length, 2);
  const latestBlockEvent = blockEvents[0]; // ordered by at DESC
  assert.equal(latestBlockEvent.agentId, "block-a1");
  assert.equal(latestBlockEvent.reason, undefined);
});
