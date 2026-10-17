import test from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/server";
import { CONTEXT_SECTIONS, registerPaginationTools } from "./pagination-tools.js";
import { createTask, registerAgent } from "./store.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper reads arbitrary result shapes
type Handler = (input: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{ isError?: boolean; structuredContent: any }>;

function contextTool() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper reads arbitrary result shapes
  const tools = new Map<string, { config: any; handler: Handler }>();
  const server = { registerTool: (name: string, config: unknown, handler: Handler) => { tools.set(name, { config, handler }); } } as unknown as McpServer;
  registerPaginationTools(server);
  const tool = tools.get("conduit_context");
  assert.ok(tool, "conduit_context registered");
  return tool;
}

test("conduit_context rejects a top-level cursor with a clear validation error instead of ignoring it", async () => {
  const { handler } = contextTool();
  const result = await handler({ cursor: "anything", limit: 5 }, {});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "context_cursor_unsupported");
  assert.match(result.structuredContent.error.message, /cursors\.<section>/);
  assert.deepEqual(result.structuredContent.error.details, { field: "cursor", use: "cursors", sections: [...CONTEXT_SECTIONS] });
});

test("conduit_context rejects an empty top-level cursor too (presence, not truthiness)", async () => {
  const { handler } = contextTool();
  const result = await handler({ cursor: "" }, {});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "context_cursor_unsupported");
});

test("conduit_context still honours per-section cursors", async () => {
  const { handler } = contextTool();
  const prefix = `ctx-${crypto.randomUUID()}`;
  for (let i = 0; i < 3; i++) await registerAgent({ id: `${prefix}-${i}`, name: `ctx ${i}` });
  for (let i = 0; i < 2; i++) assert.ok(await createTask({ title: `${prefix} task ${i}`, createdBy: `${prefix}-0` }));
  const first = await handler({ limit: 1 }, {});
  assert.notEqual(first.isError, true);
  const firstPage = first.structuredContent.coordination.agents;
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);
  const second = await handler({ limit: 1, cursors: { agents: firstPage.nextCursor } }, {});
  assert.notEqual(second.isError, true);
  assert.notEqual(second.structuredContent.coordination.agents.items[0].id, firstPage.items[0].id);
  // cursors.agents must only advance the agents section: tasks (deterministically seeded above) stay on page one.
  const firstTasks = first.structuredContent.coordination.tasks;
  assert.equal(firstTasks.items.length, 1);
  assert.deepEqual(second.structuredContent.coordination.tasks.items.map((t: { id: string }) => t.id), firstTasks.items.map((t: { id: string }) => t.id));
});

test("conduit_context schema documents the per-section contract for cursor", () => {
  const { config } = contextTool();
  const shape = config.inputSchema.shape;
  assert.match(shape.cursor.description, /cursors\.<section>/);
  assert.deepEqual(Object.keys(shape.cursors.unwrap().shape).sort(), [...CONTEXT_SECTIONS].sort());
});
