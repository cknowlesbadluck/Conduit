import test from "node:test";
import assert from "node:assert/strict";
import { createDevelopmentAuthInfo, DEVELOPMENT_TOKEN_SUBJECT } from "./auth.js";
import { actorSubject, oauthSubject, resolveBoundAgent, type ToolExtra } from "./mcp.js";
import { registerAgent, getBoundAgentId, listSubjectsForAgent } from "./store.js";

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

test("actorSubject uses client_id::sub when both claims exist", () => {
  const extra = extraFor("user-sub-shared", "client-grok");
  assert.equal(oauthSubject(extra), "user-sub-shared");
  assert.equal(actorSubject(extra), "client-grok::user-sub-shared");
});

test("subject-only actors keep legacy binding key", () => {
  const extra = extraFor("user-sub-only");
  assert.equal(oauthSubject(extra), "user-sub-only");
  assert.equal(actorSubject(extra), "user-sub-only");
});

test("distinct OAuth clients under the same sub bind independent logical agents", async () => {
  const sharedSub = "user-sub-shared-multi";
  const grokClient = "oauth-client-grok";
  const sparkClient = "oauth-client-spark";

  const grokExtra = extraFor(sharedSub, grokClient);
  const sparkExtra = extraFor(sharedSub, sparkClient);

  assert.equal(actorSubject(grokExtra), `${grokClient}::${sharedSub}`);
  assert.equal(actorSubject(sparkExtra), `${sparkClient}::${sharedSub}`);

  await registerAgent({ id: "grok-client-bind", name: "Grok", actorSubject: actorSubject(grokExtra)! });
  await registerAgent({ id: "spark-client-bind", name: "Spark", actorSubject: actorSubject(sparkExtra)! });

  assert.equal(await getBoundAgentId(`${grokClient}::${sharedSub}`), "grok-client-bind");
  assert.equal(await getBoundAgentId(`${sparkClient}::${sharedSub}`), "spark-client-bind");
  assert.equal(await resolveBoundAgent(grokExtra), "grok-client-bind");
  assert.equal(await resolveBoundAgent(sparkExtra), "spark-client-bind");
  assert.equal(await resolveBoundAgent(grokExtra, "spark-client-bind"), null);
  assert.equal(await resolveBoundAgent(sparkExtra, "grok-client-bind"), null);
});

test("qualified client still falls back to a legacy subject binding", async () => {
  const sharedSub = "legacy-sub-only";
  const clientId = "new-client-for-legacy";

  await registerAgent({ id: "legacy-agent", name: "Legacy Agent", actorSubject: sharedSub });

  const extra = extraFor(sharedSub, clientId);
  assert.equal(actorSubject(extra), `${clientId}::${sharedSub}`);
  assert.equal(await resolveBoundAgent(extra), "legacy-agent");

  const subjectOnly = extraFor(sharedSub);
  assert.equal(actorSubject(subjectOnly), sharedSub);
  assert.equal(await resolveBoundAgent(subjectOnly), "legacy-agent");
});

test("same OAuth client and different users do not share a binding key", () => {
  const clientId = "shared-host-client";
  const a = extraFor("user-a", clientId);
  const b = extraFor("user-b", clientId);
  assert.equal(actorSubject(a), `${clientId}::user-a`);
  assert.equal(actorSubject(b), `${clientId}::user-b`);
  assert.notEqual(actorSubject(a), actorSubject(b));
});

test("one logical agent may accept a second qualified subject", async () => {
  const agentId = "shared-logical-grok";
  assert.ok(await registerAgent({ id: agentId, name: "Grok", actorSubject: "legacy-sub-grok" }));
  assert.ok(await registerAgent({ id: agentId, name: "Grok", actorSubject: "client-x::legacy-sub-grok" }));
  assert.equal(await getBoundAgentId("legacy-sub-grok"), agentId);
  assert.equal(await getBoundAgentId("client-x::legacy-sub-grok"), agentId);
});

test("listSubjectsForAgent returns every subject bound to a logical agent", async () => {
  const agentId = "list-subjects-agent";
  assert.ok(await registerAgent({ id: agentId, name: "List Subjects", actorSubject: "sub-a" }));
  assert.ok(await registerAgent({ id: agentId, name: "List Subjects", actorSubject: "client-z::sub-a" }));
  const subjects = await listSubjectsForAgent(agentId);
  assert.deepEqual(subjects, ["client-z::sub-a", "sub-a"]);
});
