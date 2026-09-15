import test from "node:test";
import assert from "node:assert/strict";
import { createTask, registerAgent, registerTool } from "./store.js";
import { getConduitStatus, getPublicConduitStatus } from "./status.js";

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

test("public status projection omits identifiers and payloads", async () => {
  await registerAgent({ id: "public-status-agent", name: "Should Not Leak", actorSubject: "public-status-subject" });
  await createTask({ title: "secret coordination title", createdBy: "public-status-agent" });

  const published = await getPublicConduitStatus();
  const serialized = JSON.stringify(published);

  assert.equal(published.connections.length, 0);
  assert.equal(published.tools.length, 0);
  assert.equal(published.tasks.length, 0);
  assert.equal(published.activity.length, 0);
  assert.ok(published.counts.agents >= 1);
  assert.ok(published.counts.tasks >= 1);
  assert.doesNotMatch(serialized, /public-status-agent/);
  assert.doesNotMatch(serialized, /secret coordination title/);
  assert.doesNotMatch(serialized, /Should Not Leak/);
});

test("status projection redacts sensitive activity keys", async () => {
  const status = await getConduitStatus();
  for (const event of status.activity) {
    for (const key of Object.keys(event)) {
      assert.doesNotMatch(key, /token|secret|password|authorization|api[_-]?key/i);
    }
  }
});
