import test from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/server";
import { backdateTaskForTests, blockTask, claimTask, createTask, reclaimStaleTask, registerAgent, staleClaimMs, taskHealth } from "./store.js";
import { registerTaskRecoveryTools } from "./task-recovery-tools.js";

const MIN = 60_000;
const uid = () => Math.random().toString(36).slice(2, 10);

async function setup() {
  const s = uid();
  const a = `holder-${s}`; const b = `rescuer-${s}`;
  await registerAgent({ id: a, name: a }); await registerAgent({ id: b, name: b });
  const task = (await createTask({ title: `t-${s}`, description: "d", createdBy: a }))!;
  assert.ok(await claimTask(task.id, a));
  return { a, b, taskId: task.id };
}

test("staleClaimMs: disabled unless configured, clamped to 1..10080 minutes", () => {
  assert.equal(staleClaimMs({}), null);
  assert.equal(staleClaimMs({ CONDUIT_TASK_STALE_CLAIM_MINUTES: "0" }), null);
  assert.equal(staleClaimMs({ CONDUIT_TASK_STALE_CLAIM_MINUTES: "abc" }), null);
  assert.equal(staleClaimMs({ CONDUIT_TASK_STALE_CLAIM_MINUTES: "30" }), 30 * MIN);
  assert.equal(staleClaimMs({ CONDUIT_TASK_STALE_CLAIM_MINUTES: "999999" }), 10080 * MIN);
});

test("a fresh claim cannot be reclaimed; a stale one moves atomically to the rescuer", async () => {
  const { a, b, taskId } = await setup();
  assert.equal(await reclaimStaleTask(taskId, b, 30 * MIN), null, "fresh claim is protected");
  backdateTaskForTests(taskId, 31 * MIN);
  const result = await reclaimStaleTask(taskId, b, 30 * MIN);
  assert.ok(result);
  assert.equal(result.task.claimedBy, b);
  assert.equal(result.task.status, "claimed");
  assert.equal(result.previousAgentId, a);
  assert.ok(result.idleMs >= 31 * MIN);
  assert.equal(await reclaimStaleTask(taskId, b, 30 * MIN), null, "now fresh again and held by the caller");
  assert.equal(await reclaimStaleTask(taskId, a, 30 * MIN), null, "the old holder cannot snatch it straight back");
});

test("blocked tasks are reclaimable; open, own and unknown-agent cases are refused", async () => {
  const { a, b, taskId } = await setup();
  assert.ok(await blockTask(taskId, a, "waiting"));
  backdateTaskForTests(taskId, 2 * 60 * MIN);
  assert.equal(await reclaimStaleTask(taskId, a, 30 * MIN), null, "holder can't reclaim its own task");
  assert.equal(await reclaimStaleTask(taskId, "nobody-registered", 30 * MIN), null);
  assert.equal(await reclaimStaleTask(taskId, b, 30), null, "thresholds under one minute are refused");
  assert.equal((await reclaimStaleTask(taskId, b, 30 * MIN))?.task.status, "claimed");
  const open = (await createTask({ title: `open-${uid()}`, description: "d", createdBy: a }))!;
  backdateTaskForTests(open.id, 2 * 60 * MIN);
  assert.equal(await reclaimStaleTask(open.id, b, 30 * MIN), null, "open tasks are claimed, not reclaimed");
});

test("taskHealth counts by status and buckets held tasks by idle time", async () => {
  const project = undefined;
  const before = await taskHealth(project, 30 * MIN);
  const { taskId } = await setup();
  backdateTaskForTests(taskId, 3 * 60 * MIN);
  const after = await taskHealth(project, 30 * MIN);
  assert.equal(after.counts.claimed, before.counts.claimed + 1);
  assert.equal(after.heldByAge.under24h, before.heldByAge.under24h + 1);
  assert.equal(after.reclaimable, before.reclaimable + 1);
  assert.equal(after.staleClaimMinutes, 30);
  assert.equal((await taskHealth(project, null)).reclaimable, 0, "nothing is reclaimable when recovery is disabled");
});

type Handler = (input: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> }>;

function tools(resolveAs: string) {
  const map = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, handler: Handler) => { map.set(name, handler); } } as unknown as McpServer;
  registerTaskRecoveryTools(server, undefined, async () => resolveAs);
  return map;
}

test("task_reclaim is disabled by default and works through the tool when configured", async () => {
  const { b, taskId } = await setup();
  const saved = process.env.CONDUIT_TASK_STALE_CLAIM_MINUTES;
  try {
    delete process.env.CONDUIT_TASK_STALE_CLAIM_MINUTES;
    const disabled = await tools(b).get("task_reclaim")!({ taskId }, {});
    assert.equal(disabled.isError, true);
    assert.match(disabled.content[0].text, /stale_reclaim_disabled/);

    process.env.CONDUIT_TASK_STALE_CLAIM_MINUTES = "15";
    const fresh = await tools(b).get("task_reclaim")!({ taskId }, {});
    assert.match(fresh.content[0].text, /task_not_reclaimable/);
    backdateTaskForTests(taskId, 16 * MIN);
    const ok = await tools(b).get("task_reclaim")!({ taskId }, {});
    assert.notEqual(ok.isError, true);
    assert.equal(ok.structuredContent?.claimedBy, b);
    assert.ok(typeof ok.structuredContent?.reclaimedFrom === "string");

    const health = await tools(b).get("task_health")!({}, {});
    assert.equal(health.structuredContent?.staleClaimMinutes, 15);
  } finally {
    if (saved === undefined) delete process.env.CONDUIT_TASK_STALE_CLAIM_MINUTES; else process.env.CONDUIT_TASK_STALE_CLAIM_MINUTES = saved;
  }
});
