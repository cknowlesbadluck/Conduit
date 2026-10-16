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

test("isGrantAdmin matches composite key, bare sub, client-credentials clientId or client:<id>; empty env grants nobody", () => {
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
    // Fixed (was pinned in #237): a bare clientId entry no longer admits every user `sub`
    // of that OAuth client. It still matches a client-credentials token (no sub / sub === clientId).
    process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = "only-client";
    assert.equal(isGrantAdmin(caller("only-client", "y")), false, "bare clientId must not admit users of the client");
    assert.equal(isGrantAdmin(caller("only-client", "only-client")), true, "client-credentials token: client is the subject");
    assert.equal(isGrantAdmin({ http: { authInfo: { token: "t", clientId: "only-client", scopes: [], extra: {} } } }), true);
    // Explicit client-scoped form admits every subject of that client, and only that client.
    process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = "client:only-client";
    assert.equal(isGrantAdmin(caller("only-client", "y")), true);
    assert.equal(isGrantAdmin(caller("another-client", "y")), false);
    assert.equal(isGrantAdmin(caller("x", "client:only-client")), true, "literal sub match is unaffected");
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

test("grant_revoke: creator revokes, non-governor refused; revoked grants hidden unless governor asks", async () => {
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

test("grant_revoke: a grant admin can revoke a grant a project owner created (fixed from #237)", async () => {
  const { tool, target, projectId, ownerCtx } = await setup();
  const created = await tool("grant_create")({ agentId: target, projectId, provider: "github", method: "GET", pathPattern: "/admin-revoke" }, ownerCtx);
  const grantId = created.structuredContent?.id as string;
  assert.ok(grantId);
  const prev = process.env.CONDUIT_GRANT_ADMIN_SUBJECTS;
  try {
    process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = `admin-c-${sfx}::admin-s-${sfx}`;
    const adminCtx = caller(`admin-c-${sfx}`, `admin-s-${sfx}`);
    // Bare client id of the admin's client must NOT be enough for a different user.
    assert.match(errorOf(await tool("grant_revoke")({ grantId, projectId }, caller(`admin-c-${sfx}`, `intruder-${sfx}`))), /grant_admin_required/);
    assert.deepEqual((await tool("grant_revoke")({ grantId, projectId }, adminCtx)).structuredContent, { revoked: true, grantId });
    assert.deepEqual((await tool("grant_revoke")({ grantId }, adminCtx)).structuredContent, { revoked: true, grantId }, "idempotent, no projectId needed for admin");
    assert.match(errorOf(await tool("grant_revoke")({ grantId: `missing-${sfx}` }, adminCtx)), /grant_not_found_or_not_owned/);
  } finally {
    if (prev === undefined) delete process.env.CONDUIT_GRANT_ADMIN_SUBJECTS; else process.env.CONDUIT_GRANT_ADMIN_SUBJECTS = prev;
  }
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
