import test from "node:test";
import assert from "node:assert/strict";
import {
  addContact, agentExists, claimTask, completeTask, countActivity, countAgents, countTasks, countTools, createProject, createTask,
  getBoundAgentId, getCoordinationContext, handoff, init, listActivity, listAgents, listContacts, listTasks, listTools, registerAgent, registerTool,
} from "./store.js";

// Runs against the in-memory store locally and against PostgreSQL in the CI postgres-coordination job,
// so the same behavioural assertions cover both branches of every store function exercised here.
const uid = () => crypto.randomUUID();
const isIso = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

test.before(async () => { await init(); });

test("registerAgent and listAgents return the Agent shape (ISO string createdAt) in every store mode", async () => {
  const agentId = `shape-${uid()}`;
  const registered = await registerAgent({ id: agentId, name: "shape", description: "d" });
  assert.ok(registered);
  assert.equal(registered.id, agentId);
  assert.ok(isIso(registered.createdAt), `registerAgent createdAt should be an ISO string, got ${String(registered.createdAt)}`);
  const listed = (await listAgents()).find(agent => agent.id === agentId);
  assert.ok(listed);
  assert.ok(isIso(listed.createdAt), `listAgents createdAt should be an ISO string, got ${String(listed.createdAt)}`);
  assert.equal(listed.description, "d");
  const bare = await registerAgent({ id: `${agentId}-bare`, name: "bare" });
  assert.equal(bare?.description, undefined, "a missing description is undefined, not null");
});

test("re-registering an agent keeps its original createdAt and updates name", async () => {
  const agentId = `rereg-${uid()}`;
  const first = await registerAgent({ id: agentId, name: "before" });
  const second = await registerAgent({ id: agentId, name: "after" });
  assert.equal(second?.name, "after");
  assert.equal(second?.createdAt, first?.createdAt);
});

test("actor binding: a subject binds to one agent, rebinding to another id is refused, lookup works", async () => {
  const subject = `sub-${uid()}`;
  const agentId = `bound-${uid()}`;
  assert.equal(await getBoundAgentId(subject), undefined);
  assert.ok(await registerAgent({ id: agentId, name: "bound", actorSubject: subject }));
  assert.equal(await getBoundAgentId(subject), agentId);
  assert.equal(await registerAgent({ id: `other-${uid()}`, name: "imposter", actorSubject: subject }), null);
  assert.ok(await registerAgent({ id: agentId, name: "same agent again", actorSubject: subject }), "same agent may re-register");
  assert.equal(await agentExists(agentId), true);
  assert.equal(await agentExists(`missing-${uid()}`), false);
});

test("completeTask: only the claimer completes a claimed task; open, foreign and repeated completes are refused", async () => {
  const owner = `owner-${uid()}`;
  const other = `other-${uid()}`;
  await registerAgent({ id: owner, name: "owner" });
  await registerAgent({ id: other, name: "other" });
  const task = await createTask({ title: "complete me", createdBy: owner });
  assert.ok(task);
  assert.equal(await completeTask(task.id, owner), null, "open task cannot be completed");
  assert.ok(await claimTask(task.id, owner));
  assert.equal(await completeTask(task.id, other), null, "foreign agent cannot complete");
  assert.equal(await completeTask(task.id, `ghost-${uid()}`), null, "unregistered agent cannot complete");
  const done = await completeTask(task.id, owner);
  assert.equal(done?.status, "completed");
  assert.equal(done?.claimedBy, owner);
  assert.equal(await completeTask(task.id, owner), null, "completed task cannot be completed twice");
  assert.ok((await listActivity(200)).some(event => event.type === "task.complete" && event.taskId === task.id));
});

test("handoff: claimer hands a task to a registered agent with a note; self, unregistered and non-claimer handoffs are refused", async () => {
  const from = `from-${uid()}`;
  const to = `to-${uid()}`;
  await registerAgent({ id: from, name: "from" });
  await registerAgent({ id: to, name: "to" });
  const project = await createProject({ name: `handoff-${uid()}`, createdBy: from });
  const task = await createTask({ title: "pass it on", createdBy: from, projectId: project!.id });
  assert.equal(await handoff(task!.id, from, to), null, "open task cannot be handed off");
  await claimTask(task!.id, from);
  assert.equal(await handoff(task!.id, from, from), null, "self handoff refused");
  assert.equal(await handoff(task!.id, from, `ghost-${uid()}`), null, "unregistered target refused");
  assert.equal(await handoff(task!.id, to, from), null, "non-claimer cannot hand off");
  const moved = await handoff(task!.id, from, to, "over to you");
  assert.equal(moved?.claimedBy, to);
  assert.equal(moved?.handoffNote, "over to you");
  assert.equal(moved?.projectId, project!.id);
  const noNote = await handoff(task!.id, to, from);
  assert.equal(noNote?.handoffNote, "");
  const events = await listActivity(50, project!.id);
  assert.ok(events.some(event => event.type === "task.handoff" && event.toAgent === to && event.note === "over to you"));
});

test("listTasks supports the legacy (status, projectId) signature and every filter", async () => {
  const a = `la-${uid()}`;
  const b = `lb-${uid()}`;
  await registerAgent({ id: a, name: "a" });
  await registerAgent({ id: b, name: "b" });
  const project = await createProject({ name: `filters-${uid()}`, createdBy: a });
  const open = await createTask({ title: "open", createdBy: a, projectId: project!.id });
  const claimed = await createTask({ title: "claimed", createdBy: b, projectId: project!.id });
  await claimTask(claimed!.id, a);
  const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();
  assert.deepEqual(ids(await listTasks("open", project!.id)), [open!.id]);
  assert.deepEqual(ids(await listTasks({ projectId: project!.id })), [open!.id, claimed!.id].sort());
  assert.deepEqual(ids(await listTasks({ projectId: project!.id, claimedBy: a })), [claimed!.id]);
  assert.deepEqual(ids(await listTasks({ projectId: project!.id, createdBy: b })), [claimed!.id]);
  assert.deepEqual(ids(await listTasks({ projectId: project!.id, status: "completed" })), []);
  assert.ok((await listTasks()).some(task => task.id === open!.id), "no filter lists everything");
});

test("contacts and tools: project scoping, unknown project/creator refused, newest first", async () => {
  const agentId = `ct-${uid()}`;
  await registerAgent({ id: agentId, name: "ct" });
  const project = await createProject({ name: `ct-${uid()}`, createdBy: agentId });
  assert.equal(await addContact("x", "y", "email", `project_missing_${uid()}`), null);
  assert.equal(await addContact("x", "y", "email", undefined, `ghost-${uid()}`), null);
  assert.equal(await registerTool("t", "d", undefined, `project_missing_${uid()}`), null);
  assert.equal(await registerTool("t", "d", undefined, undefined, `ghost-${uid()}`), null);
  const c1 = await addContact("first", "a@example.com", "email", project!.id, agentId);
  const c2 = await addContact("second", "b@example.com", "email", project!.id, agentId);
  const global = await addContact("global", "g@example.com", "email");
  const t1 = await registerTool("tool", "desc", "https://example.com/mcp", project!.id, agentId);
  const scopedContacts = await listContacts(project!.id);
  assert.deepEqual(new Set(scopedContacts.map(c => c.id)), new Set([c1!.id, c2!.id]));
  assert.ok((await listContacts()).some(c => c.id === global!.id));
  const scopedTools = await listTools(project!.id);
  assert.deepEqual(scopedTools.map(t => t.id), [t1!.id]);
  assert.equal(scopedTools[0].endpoint, "https://example.com/mcp");
  assert.equal(scopedTools[0].createdBy, agentId);
});

test("listActivity clamps limit to 1..200 and filters by project", async () => {
  const agentId = `act-${uid()}`;
  await registerAgent({ id: agentId, name: "act" });
  const project = await createProject({ name: `act-${uid()}`, createdBy: agentId });
  for (let i = 0; i < 3; i++) await createTask({ title: `t${i}`, createdBy: agentId, projectId: project!.id });
  assert.equal((await listActivity(0)).length, 1, "limit below 1 clamps to 1");
  assert.ok((await listActivity(10_000)).length <= 200, "limit above 200 clamps to 200");
  const scoped = await listActivity(50, project!.id);
  assert.equal(scoped.length, 4, "project.create + 3 task.create");
  assert.ok(scoped.every(event => event.projectId === project!.id));
  assert.ok(scoped.every(event => isIso(event.at)));
});

test("getCoordinationContext: unknown project is null; project view is scoped and omits the project list; global view lists projects", async () => {
  const agentId = `ctx-${uid()}`;
  await registerAgent({ id: agentId, name: "ctx" });
  const project = await createProject({ name: `ctx-${uid()}`, createdBy: agentId });
  const task = await createTask({ title: "ctx", createdBy: agentId, projectId: project!.id });
  assert.equal(await getCoordinationContext(`project_missing_${uid()}`), null);
  const scoped = await getCoordinationContext(project!.id);
  assert.equal(scoped?.project?.id, project!.id);
  assert.deepEqual(scoped?.projects, []);
  assert.deepEqual(scoped?.tasks.map(t => t.id), [task!.id]);
  assert.ok(scoped?.activity.every(event => event.projectId === project!.id));
  const global = await getCoordinationContext();
  assert.equal(global?.project, null);
  assert.ok(global?.projects.some(p => p.id === project!.id));
  assert.equal(global?.service, "Conduit");
});

test("counts track writes", async () => {
  const before = { agents: await countAgents(), tasks: await countTasks(), tools: await countTools(), activity: await countActivity() };
  const agentId = `count-${uid()}`;
  await registerAgent({ id: agentId, name: "count" });
  await createTask({ title: "count", createdBy: agentId });
  await registerTool("count", "count", undefined, undefined, agentId);
  assert.equal(await countAgents(), before.agents + 1);
  assert.equal(await countTasks(), before.tasks + 1);
  assert.equal(await countTools(), before.tools + 1);
  assert.ok((await countActivity()) >= Math.min(before.activity + 3, before.activity + 1), "activity grows (memory store caps at the retention limit)");
});
