import test from "node:test";
import assert from "node:assert/strict";
import { init, registerAgent, createProject } from "./store.js";
import { createConduitServer } from "./mcp.js";
import { isGrantAdmin } from "./grant-tools.js";
import type { ConduitAuthConfig } from "./auth.js";

/**
 * Authorization matrix for grant_create / grant_revoke / grants_list (src/grant-tools.ts).
 * Deny-by-default: only grant admins (CONDUIT_GRANT_ADMIN_SUBJECTS) and the owner of a
 * project may govern grants; everyone else sees only their own grants.
 */
const authConfig = {
  enabled: true, issuer: "https://issuer.invalid", discoveryUrl: "https://issuer.invalid/.well-known", resourceUrl: "https://conduit.invalid/mcp",
  metadata: {} as ConduitAuthConfig["metadata"], readScope: "conduit:read", writeScope: "conduit:write",
} as ConduitAuthConfig;

type Result = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> };
type Handler = (input: unknown, extra: unknown) => Promise<Result>;
const caller = (clientId: string, sub: string) => ({ http: { authInfo: { token: "t", clientId, scopes: ["conduit:read", "conduit:write"], extra: { sub } } } });
const errorOf = (r: Result) => (r.isError ? JSON.stringify(r.content ?? r.structuredContent ?? "") : "");
const sfx = Math.random().toString(36).slice(2, 8);

async function setup() {
  await init();
  const server = createConduitServer(authConfig) as unknown as { _registeredTools: Record<string, { handler: Handler }> };
  const tool = (name: string) => server._registeredTools[name].handler;
  const owner = `owner-${sfx}`, other = `other-${sfx}`, target = `target-${sfx}`;
  await registerAgent({ id: owner, name: owner, actorSubject: `c-${owner}::s-${owner}` });
  await registerAgent({ id: other, name: other, actorSubject: `c-${other}::s-${other}` });
  await registerAgent({ id: target, name: target });
  const project = await createProject({ name: `p-${sfx}`, createdBy: owner });
  assert.ok(project);
  return { tool, owner, other, target, projectId: project.id, ownerCtx: caller(`c-${owner}`, `s-${owner}`), otherCtx: caller(`c-${other}`, `s-${other}`) };
}

test("isGrantAdmin matches composite key, bare sub or bare clientId; empty env grants nobody", () => {
  const prev = process.env.CONDUIT_GRANT_ADMIN_SUBJECTS;
  try {
    delete process.env.CONDUIT_GRANT_ADMIN_SUBJECTS;
    assert.equal(isGrantAdmin(caller("c", "s")), false);
    assert.equal(isGrantAdmin({}), false);
    process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = " c::s , ";
    assert.equal(isGrantAdmin(caller("c", "s")), true);
    assert.equal(isGrantAdmin(caller("c", "other")), false);
    process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = "only-sub";
    assert.equal(isGrantAdmin(caller("x", "only-sub")), true);
    // CURRENT BEHAVIOUR, flagged in review of #235: a bare clientId entry also admits every
    // user `sub` of that OAuth client. Pinned here so a fix (restrict to client-credentials
    // tokens without a distinct sub) is a deliberate, visible change to this assertion.
    process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = "only-client";
    assert.equal(isGrantAdmin(caller("only-client", "y")), true);
    assert.equal(isGrantAdmin({}), false, "unauthenticated caller is never admin");
  } finally {
    if (prev === undefined) delete process.env.CONDUIT_GRANT_ADMIN_SUBJECTS; else process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = prev;
  }
});

test("grant_create: non-owner refused, missing project refused, project owner allowed", async () => {
  const { tool, target, projectId, ownerCtx, otherCtx } = await setup();
  const base = { agentId: target, provider: "github", method: "get", pathPattern: "/repos/*" };
  assert.match(errorOf(await tool("grant_create")({ ...base, projectId }, otherCtx)), /grant_admin_required/);
  assert.match(errorOf(await tool("grant_create")(base, ownerCtx)), /grant_admin_required/, "no project and not admin");
  const ok = await tool("grant_create")({ ...base, projectId }, ownerCtx);
  assert.equal(ok.isError, undefined);
  assert.equal(ok.structuredContent?.method, "GET");
  assert.equal(ok.structuredContent?.agentId, target);
});

test("grant_create surfaces store errors (unregistered agent) as tool errors", async () => {
  const { tool, projectId, ownerCtx } = await setup();
  const r = await tool("grant_create")({ agentId: `ghost-${sfx}`, projectId, provider: "github", method: "GET", pathPattern: "/x" }, ownerCtx);
  assert.match(errorOf(r), /agent_unregistered/);
});

// CURRENT BEHAVIOUR, flagged in review of #235: revocation filters on created_by, so a
// grant admin cannot revoke a grant created by a project owner. Tracked as a runtime follow-up.
test("grant_revoke: only the creator revokes; revoked grants hidden unless governor asks", async () => {
  const { tool, target, projectId, ownerCtx, otherCtx } = await setup();
  const created = await tool("grant_create")({ agentId: target, projectId, provider: "github", method: "GET", pathPattern: "/r" }, ownerCtx);
  const grantId = created.structuredContent?.id as string;
  assert.match(errorOf(await tool("grant_revoke")({ grantId, projectId }, otherCtx)), /grant_admin_required/);
  assert.match(errorOf(await tool("grant_revoke")({ grantId: "nope", projectId }, ownerCtx)), /grant_not_found_or_not_owned/);
  const revoked = await tool("grant_revoke")({ grantId, projectId }, ownerCtx);
  assert.deepEqual(revoked.structuredContent, { revoked: true, grantId });

  const ids = (r: Result) => (r.structuredContent as unknown as Array<{ id: string }>).map((g) => g.id);
  assert.ok(!ids(await tool("grants_list")({ agentId: target, projectId }, ownerCtx)).includes(grantId));
  assert.ok(ids(await tool("grants_list")({ agentId: target, projectId, includeRevoked: true }, ownerCtx)).includes(grantId));
  assert.match(errorOf(await tool("grants_list")({ projectId, includeRevoked: true }, otherCtx)), /grant_admin_required/);
});

test("grants_list: non-governor cannot list another agent's grants", async () => {
  const { tool, target, other, projectId, ownerCtx, otherCtx } = await setup();
  const foreign = await tool("grant_create")({ agentId: target, projectId, provider: "github", method: "GET", pathPattern: "/f" }, ownerCtx);
  const foreignId = foreign.structuredContent?.id as string;
  assert.ok(foreignId);
  assert.match(errorOf(await tool("grants_list")({ agentId: target }, otherCtx)), /grant_admin_required/);
  for (const input of [{ agentId: other }, {}, { projectId }]) {
    const own = await tool("grants_list")(input, otherCtx);
    assert.equal(own.isError, undefined);
    const rows = own.structuredContent as unknown as Array<{ id: string; agentId: string }>;
    assert.ok(rows.every((g) => g.agentId === other), `non-governor saw foreign grants for ${JSON.stringify(input)}`);
    assert.ok(!rows.some((g) => g.id === foreignId));
  }
});

test("grant tools require scopes", async () => {
  const { tool, projectId } = await setup();
  const noScope = { http: { authInfo: { token: "t", clientId: "c", scopes: [] as string[], extra: { sub: "s" } } } };
  for (const [name, input] of [["grant_create", { agentId: "a", projectId, provider: "github", method: "GET", pathPattern: "/" }], ["grant_revoke", { grantId: "g" }], ["grants_list", {}]] as const) {
    await assert.rejects(() => tool(name)(input, noScope), /scope|insufficient/i);
  }
});
