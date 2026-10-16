import test from "node:test";
import assert from "node:assert/strict";
import { REDACTED, redactRecord, redactString } from "./redact.js";
import { init, registerAgent, createTask, claimTask, blockTask, handoff, listActivity } from "./store.js";

const GH = "ghp_" + "q".repeat(36);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

test("redactString masks credential shapes, auth headers, query secrets and URL passwords", () => {
  const out = redactString(`err ${GH} Bearer abcdefgh12345678 ${JWT} /repos?access_token=xyz123&page=2 postgres://u:pw-value@db/x`);
  for (const leak of [GH, "abcdefgh12345678", JWT, "xyz123", "pw-value"]) assert.ok(!out.includes(leak), leak);
  assert.match(out, /page=2/);
  assert.match(out, /Bearer \[REDACTED\]/);
});

test("redactRecord masks sensitive keys and nested strings, keeps ids", () => {
  assert.deepEqual(redactRecord({ taskId: "task_1", token: "t", nested: { note: `use ${GH}` } }), { taskId: "task_1", token: REDACTED, nested: { note: `use ${REDACTED}` } });
});

test("free-text activity fields (block reason, handoff note) are redacted before persistence", async () => {
  await init();
  await registerAgent({ id: "red-a", name: "Red A", actorSubject: "red-a-sub" });
  await registerAgent({ id: "red-b", name: "Red B", actorSubject: "red-b-sub" });
  const task = await createTask({ title: "Redaction task", createdBy: "red-a" });
  await claimTask(task!.id, "red-a");
  await blockTask(task!.id, "red-a", `blocked: GitHub 401 for ${GH}`);
  await handoff(task!.id, "red-a", "red-b", `here is the key ${JWT}`);
  const text = JSON.stringify(await listActivity(50));
  assert.ok(text.includes(task!.id));
  assert.ok(!text.includes(GH) && !text.includes(JWT));
});
