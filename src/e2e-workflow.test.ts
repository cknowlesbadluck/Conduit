import test from "node:test";
import assert from "node:assert/strict";
import {
  registerAgent,
  createProject,
  getProject,
  createTask,
  getTask,
  listTasks,
  claimTask,
  updateTask,
  blockTask,
  releaseTask,
  handoff,
  completeTask,
  cancelTask,
  addContact,
  registerTool,
  registerResource,
  listActivity,
  getCoordinationContext,
} from "./store.js";

test("End-to-End Coordination Workflow: Agent A -> Agent B -> Agent C", async () => {
  // 1. Agent Registration & Identity Binding
  const agentA = await registerAgent({ id: "agent-a", name: "Planner Agent A", description: "Creates tasks and coordinates projects", actorSubject: "sub-agent-a" });
  const agentB = await registerAgent({ id: "agent-b", name: "Worker Agent B", description: "Executes backend implementations", actorSubject: "sub-agent-b" });
  const agentC = await registerAgent({ id: "agent-c", name: "Reviewer Agent C", description: "Reviews code and completes tasks", actorSubject: "sub-agent-c" });

  assert.ok(agentA && agentB && agentC);
  assert.equal(agentA.id, "agent-a");

  // 2. Project Creation by Agent A
  const project = await createProject({ name: "Conduit Production Build", description: "Project for building and verifying Conduit", createdBy: "agent-a" });
  assert.ok(project);
  assert.equal(project.createdBy, "agent-a");

  const projectDetails = await getProject(project.id);
  assert.equal(projectDetails?.id, project.id);

  // 3. Register Resources & Tools for Context
  const repoResource = await registerResource({ projectId: project.id, name: "Conduit Repo", description: "Main repository", kind: "repository", endpoint: "https://github.com/cknowlesbadluck/Conduit", createdBy: "agent-a" });
  assert.ok(repoResource);

  const contact = await addContact("Dev Team Lead", "lead@conduit.local", "email", project.id, "agent-a");
  assert.ok(contact);

  const buildTool = await registerTool("Deploy Service", "Triggers deployment on Render", "https://api.render.com", project.id, "agent-a");
  assert.ok(buildTool);

  // 4. Task Creation by Agent A
  const task = await createTask({ title: "Build End-to-End Coordination Feature", description: "Implement agent workflow and test verification", createdBy: "agent-a", projectId: project.id });
  assert.ok(task);
  assert.equal(task.status, "open");
  assert.equal(task.projectId, project.id);

  // 5. Agent B Discovers and Claims Task
  const openTasks = await listTasks({ status: "open", projectId: project.id });
  assert.ok(openTasks.some(t => t.id === task.id));

  // Unauthorized claim check (unregistered agent)
  const invalidClaim = await claimTask(task.id, "unregistered-agent");
  assert.equal(invalidClaim, null);

  const claimedTask = await claimTask(task.id, "agent-b");
  assert.ok(claimedTask);
  assert.equal(claimedTask.status, "claimed");
  assert.equal(claimedTask.claimedBy, "agent-b");

  // 6. Agent B Updates Task and performs work
  const updatedTask = await updateTask(task.id, "agent-b", { description: "Implement agent workflow, test verification, and handoff state" });
  assert.ok(updatedTask);
  assert.equal(updatedTask.description, "Implement agent workflow, test verification, and handoff state");

  // 7. Agent B Block & Release cycle (simulating waiting on dependencies)
  const blockedTask = await blockTask(task.id, "agent-b", "Waiting for code review target");
  assert.ok(blockedTask);
  assert.equal(blockedTask.status, "blocked");

  const releasedTask = await releaseTask(task.id, "agent-b");
  assert.ok(releasedTask);
  assert.equal(releasedTask.status, "open");

  // Re-claim after release
  const reclaimedTask = await claimTask(task.id, "agent-b");
  assert.ok(reclaimedTask);

  // 8. Agent B Hands Off Task to Agent C
  // Unauthorized completion attempt by non-owner Agent A
  const unauthorizedComplete = await completeTask(task.id, "agent-a");
  assert.equal(unauthorizedComplete, null);

  const handoffResult = await handoff(task.id, "agent-b", "agent-c", "Implementation finished. Please perform code review and verify end-to-end tests.");
  assert.ok(handoffResult);
  assert.equal(handoffResult.claimedBy, "agent-c");
  assert.equal(handoffResult.handoffNote, "Implementation finished. Please perform code review and verify end-to-end tests.");

  // 9. Agent C Receives Context & Completes Work
  const context = await getCoordinationContext(project.id);
  assert.ok(context);
  assert.equal(context.project?.id, project.id);
  assert.ok(context.tasks.some(t => t.id === task.id && t.claimedBy === "agent-c"));

  const completedTask = await completeTask(task.id, "agent-c");
  assert.ok(completedTask);
  assert.equal(completedTask.status, "completed");

  // 10. Verify Activity Trail (Global and Project-specific)
  const globalActivity = await listActivity(100);
  assert.ok(globalActivity.some(a => a.type === "agent.register"));

  const projectActivity = await listActivity(100, project.id);
  assert.ok(projectActivity.length > 0);
  assert.ok(projectActivity.some(a => a.type === "project.create"));
  assert.ok(projectActivity.some(a => a.type === "task.create"));
  assert.ok(projectActivity.some(a => a.type === "task.claim"));
  assert.ok(projectActivity.some(a => a.type === "task.update"));
  assert.ok(projectActivity.some(a => a.type === "task.handoff"));
  assert.ok(projectActivity.some(a => a.type === "task.complete"));

  // 11. Test Task Cancellation Edge Case
  const cancelTaskItem = await createTask({ title: "Temporary Spike Task", createdBy: "agent-a", projectId: project.id });
  assert.ok(cancelTaskItem);
  const canceledTask = await cancelTask(cancelTaskItem.id, "agent-a", "No longer required");
  assert.ok(canceledTask);
  assert.equal(canceledTask.status, "canceled");
});
