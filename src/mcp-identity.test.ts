import test from "node:test";
import assert from "node:assert/strict";
import { createDevelopmentAuthInfo, DEVELOPMENT_TOKEN_SUBJECT } from "./auth.js";
import { actorSubject, oauthSubject, resolveBoundAgent, type ToolExtra } from "./mcp.js";
import { registerAgent, getBoundAgentId } from "./store.js";

const extraFor = (subject?: string, clientId?: string): ToolExtra => {
  if (!subject) return {};
  return { http: { authInfo: createDevelopmentAuthInfo(subject, "test-token", clientId) } };
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

test("actorSubject prefers distinct client_id over sub", () => {
  const extra = extraFor("user-sub-shared", "client-grok");
  assert.equal(oauthSubject(extra), "user-sub-shared");
  assert.equal(actorSubject(extra), "client-grok");
});

test("distinct OAuth clients under the same sub bind independent logical agents", async () => {
  const sharedSub = "user-sub-shared-multi";
  const grokClient = "oauth-client-grok";
  const sparkClient = "oauth-client-spark";

  const grokExtra = extraFor(sharedSub, grokClient);
  const sparkExtra = extraFor(sharedSub, sparkClient);

  assert.equal(actorSubject(grokExtra), grokClient);
  assert.equal(actorSubject(sparkExtra), sparkClient);
  assert.equal(oauthSubject(grokExtra), sharedSub);
  assert.equal(oauthSubject(sparkExtra), sharedSub);

  await registerAgent({ id: "grok", name: "Grok", actorSubject: actorSubject(grokExtra)! });
  await registerAgent({ id: "spark", name: "Spark", actorSubject: actorSubject(sparkExtra)! });

  assert.equal(await getBoundAgentId(grokClient), "grok");
  assert.equal(await getBoundAgentId(sparkClient), "spark");
  assert.equal(await resolveBoundAgent(grokExtra), "grok");
  assert.equal(await resolveBoundAgent(sparkExtra), "spark");
  assert.equal(await resolveBoundAgent(grokExtra, "spark"), null);
  assert.equal(await resolveBoundAgent(sparkExtra, "grok"), null);
});

test("distinct client_id does not inherit a subject-only binding", async () => {
  const sharedSub = "legacy-sub-only";
  const clientId = "new-client-for-legacy";

  // Pre-migration binding keyed by pure subject
  await registerAgent({ id: "legacy-agent", name: "Legacy Agent", actorSubject: sharedSub });

  const extra = extraFor(sharedSub, clientId);
  assert.equal(actorSubject(extra), clientId);
  // Distinct clients must not inherit the subject binding — they start unbound
  // and register their own logical agent (e.g. spark vs grok).
  assert.equal(await resolveBoundAgent(extra), null);

  // Subject-only actors (no distinct client) still resolve the legacy binding
  const subjectOnly = extraFor(sharedSub);
  assert.equal(actorSubject(subjectOnly), sharedSub);
  assert.equal(await resolveBoundAgent(subjectOnly), "legacy-agent");
});
