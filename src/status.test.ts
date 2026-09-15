import test from "node:test";
import assert from "node:assert/strict";
import { createTask, registerAgent, registerTool } from "./store.js";
import { getConduitStatus } from "./status.js";

test("status projection reports service data and registered/active agents", async () => {
  await registerAgent({ id: "status-grok", name: "Grok", actorSubject: "status-grok-subject" });
  await registerAgent({ id: "status-idle", name: "Idle Agent" });
  await createTask({ title: "status task", createdBy: "status-grok" });
  await registerTool("Status Tool", "A status test tool", "https://example.test/tool", undefined, "status-grok");

  const status = await getConduitStatus();
  const grok = status.connections.find((connection) => connection.id === "status-grok");
  const idle = status.connections.find((connection) => connection.id === "status-idle");

  assert.equal(status.service, "Conduit");
  assert.ok(status.version.length > 0);
  assert.equal(status.status, "online");
  assert.equal(grok?.status, "connected");
  assert.ok(grok?.lastActivity);
  assert.equal(idle?.status, "registered");
  assert.ok(status.tasks.some((task) => task.title === "status task"));
  assert.ok(status.tools.some((tool) => tool.name === "Status Tool"));
  assert.ok(status.activity.length > 0);
});

test("status projection redacts sensitive activity keys", async () => {
  const status = await getConduitStatus();
  for (const event of status.activity) {
    for (const key of Object.keys(event)) {
      assert.doesNotMatch(key, /token|secret|password|authorization|api[_-]?key/i);
    }
  }
});
