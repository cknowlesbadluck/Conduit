import test from "node:test";
import assert from "node:assert/strict";
import { registerAgent, getBoundAgentId } from "./store.js";

test("same client different users stay isolated", async () => {
  assert.ok(await registerAgent({ id: "user-a-agent", name: "A", actorSubject: "client-h::user-a" }));
  assert.ok(await registerAgent({ id: "user-b-agent", name: "B", actorSubject: "client-h::user-b" }));
  assert.equal(await getBoundAgentId("client-h::user-a"), "user-a-agent");
  assert.equal(await getBoundAgentId("client-h::user-b"), "user-b-agent");
});

test("impersonation still rejected when subject already bound", async () => {
  assert.ok(await registerAgent({ id: "owned", name: "Owned", actorSubject: "owner-sub" }));
  assert.equal(await registerAgent({ id: "thief", name: "Thief", actorSubject: "owner-sub" }), null);
});
