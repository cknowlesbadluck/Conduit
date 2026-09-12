import test from "node:test";
import assert from "node:assert/strict";
import { createDevelopmentAuthInfo, DEVELOPMENT_TOKEN_SUBJECT } from "./auth.js";
import { actorSubject, resolveBoundAgent, type ToolExtra } from "./mcp.js";
import { registerAgent } from "./store.js";

const extraFor = (subject?: string): ToolExtra => {
  if (!subject) return {};
  return { http: { authInfo: createDevelopmentAuthInfo(subject, "test-token") } };
};

test("development auth info uses a stable subject for token-mode hosts", () => {
  const info = createDevelopmentAuthInfo(DEVELOPMENT_TOKEN_SUBJECT, "secret");
  assert.equal(info.clientId, DEVELOPMENT_TOKEN_SUBJECT);
  assert.equal(info.extra?.sub, DEVELOPMENT_TOKEN_SUBJECT);
  assert.deepEqual(info.scopes, []);
});

test("unauthenticated development writes honor an explicit agent id", async () => {
  assert.equal(actorSubject({}), undefined);
  assert.equal(await resolveBoundAgent({}, undefined), null);
  assert.equal(await resolveBoundAgent({}, "dev-agent"), "dev-agent");
});

test("authenticated writes use the bound agent and reject impersonation", async () => {
  await registerAgent({ id: "bound-identity-a", name: "Bound Identity A", actorSubject: "actor-identity-a" });
  await registerAgent({ id: "bound-identity-b", name: "Bound Identity B", actorSubject: "actor-identity-b" });

  const extra = extraFor("actor-identity-a");
  assert.equal(actorSubject(extra), "actor-identity-a");
  assert.equal(await resolveBoundAgent(extra), "bound-identity-a");
  assert.equal(await resolveBoundAgent(extra, "bound-identity-a"), "bound-identity-a");
  assert.equal(await resolveBoundAgent(extra, "bound-identity-b"), null);
  assert.equal(await resolveBoundAgent(extraFor("unbound-actor")), null);
});
