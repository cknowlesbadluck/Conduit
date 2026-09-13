import test from "node:test";
import assert from "node:assert/strict";
import { publishEvent, subscribeEvents, subscriberCount } from "./events.js";

test("event subscribers receive matching project lifecycle events and can unsubscribe", () => {
  const received: Record<string, string>[] = [];
  const unsubscribe = subscribeEvents({ projectId: "project_1" }, (event) => received.push(event));
  assert.equal(subscriberCount() >= 1, true);
  publishEvent({ id: "evt_1", type: "task.claim", at: new Date().toISOString(), projectId: "project_1" });
  publishEvent({ id: "evt_2", type: "task.claim", at: new Date().toISOString(), projectId: "project_2" });
  unsubscribe();
  publishEvent({ id: "evt_3", type: "task.complete", at: new Date().toISOString(), projectId: "project_1" });
  assert.equal(received.length, 1);
  assert.equal(received[0].id, "evt_1");
});
