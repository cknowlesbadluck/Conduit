import test from "node:test";
import assert from "node:assert/strict";
import {
  init,
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

await init();

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
  await registerAgent({ id: "life-a", name: "Life A", actorSubject: "life-a-sub" });
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

test("releaseTask transitions task from claimed and blocked states to open, enforcing permissions and logging activity", async () => {
  await registerAgent({ id: "release-agent-1", name: "Release Agent 1" });
  await registerAgent({ id: "release-agent-2", name: "Release Agent 2" });
  const project = await createProject({ name: "Release Test Project", createdBy: "release-agent-1" });
  assert.ok(project);

  const task = await createTask({ title: "Release Test Task", createdBy: "release-agent-1", projectId: project.id });
  assert.ok(task);

  // Releasing open task fails
  assert.equal(await releaseTask(task.id, "release-agent-1"), null);

  // Claim task
  const claimed = await claimTask(task.id, "release-agent-1");
  assert.equal(claimed?.status, "claimed");
  assert.equal(claimed?.claimedBy, "release-agent-1");

  // Releasing task with non-existent agent fails
  assert.equal(await releaseTask(task.id, "nonexistent-agent"), null);

  // Releasing task with non-existent task ID fails
  assert.equal(await releaseTask("nonexistent-task", "release-agent-1"), null);

  // Releasing task claimed by another agent fails
  assert.equal(await releaseTask(task.id, "release-agent-2"), null);

  // Release claimed task back to open
  const releasedFromClaimed = await releaseTask(task.id, "release-agent-1");
  assert.ok(releasedFromClaimed);
  assert.equal(releasedFromClaimed.status, "open");
  assert.equal(releasedFromClaimed.claimedBy, undefined);

  // Verify task in store is open
  const fetchedTask1 = await getTask(task.id);
  assert.equal(fetchedTask1?.status, "open");
  assert.equal(fetchedTask1?.claimedBy, undefined);

  // Claim and block task
  await claimTask(task.id, "release-agent-1");
  const blocked = await blockTask(task.id, "release-agent-1", "Blocked for testing");
  assert.equal(blocked?.status, "blocked");

  // Release blocked task back to open
  const releasedFromBlocked = await releaseTask(task.id, "release-agent-1");
  assert.ok(releasedFromBlocked);
  assert.equal(releasedFromBlocked.status, "open");
  assert.equal(releasedFromBlocked.claimedBy, undefined);

  // Verify task in store is open
  const fetchedTask2 = await getTask(task.id);
  assert.equal(fetchedTask2?.status, "open");
  assert.equal(fetchedTask2?.claimedBy, undefined);

  // Claim and complete task
  await claimTask(task.id, "release-agent-1");
  const completed = await completeTask(task.id, "release-agent-1");
  assert.equal(completed?.status, "completed");

  // Releasing completed task fails
  assert.equal(await releaseTask(task.id, "release-agent-1"), null);

  // Verify activity log contains task.release events
  const activity = await listActivity(50, project.id);
  const releaseEvents = activity.filter((a) => a.type === "task.release");
  assert.equal(releaseEvents.length, 2);
  assert.ok(releaseEvents.every((e) => e.taskId === task.id && e.agentId === "release-agent-1" && e.projectId === project.id));
});

test("blockTask updates task status, logs activity event, and rejects invalid calls", async () => {
  await registerAgent({ id: "block-a1", name: "Block Agent 1" });
  await registerAgent({ id: "block-a2", name: "Block Agent 2" });

  const project = await createProject({ name: "Block Test Project", createdBy: "block-a1" });
  assert.ok(project);

  const task = await createTask({ title: "Task to block", createdBy: "block-a1", projectId: project.id });
  assert.ok(task);

  assert.equal(await blockTask(task.id, "unregistered-agent", "reason"), null);
  assert.equal(await blockTask("missing-task-id", "block-a1", "reason"), null);
  assert.equal(await blockTask(task.id, "block-a1", "reason"), null);

  const claimed = await claimTask(task.id, "block-a1");
  assert.ok(claimed);
  assert.equal(claimed.status, "claimed");

  assert.equal(await blockTask(task.id, "block-a2", "not claimant"), null);

  const blockedWithReason = await blockTask(task.id, "block-a1", "Waiting for dependency");
  assert.ok(blockedWithReason);
  assert.equal(blockedWithReason.status, "blocked");
  assert.equal(blockedWithReason.claimedBy, "block-a1");

  const activity1 = await listActivity(50, project.id);
  const blockEvent1 = activity1.find((e) => e.type === "task.block" && e.taskId === task.id);
  assert.ok(blockEvent1);
  assert.equal(blockEvent1.agentId, "block-a1");
  assert.equal(blockEvent1.reason, "Waiting for dependency");
  assert.equal(blockEvent1.projectId, project.id);

  assert.equal(await blockTask(task.id, "block-a1", "already blocked"), null);

  const released = await releaseTask(task.id, "block-a1");
  assert.ok(released);
  const claimedAgain = await claimTask(task.id, "block-a1");
  assert.ok(claimedAgain);

  const blockedNoReason = await blockTask(task.id, "block-a1");
  assert.ok(blockedNoReason);
  assert.equal(blockedNoReason.status, "blocked");

  const activity2 = await listActivity(50, project.id);
  const blockEvents = activity2.filter((e) => e.type === "task.block" && e.taskId === task.id);
  assert.equal(blockEvents.length, 2);
  const latestBlockEvent = blockEvents[0];
  assert.equal(latestBlockEvent.agentId, "block-a1");
  assert.equal(latestBlockEvent.reason, undefined);
});
