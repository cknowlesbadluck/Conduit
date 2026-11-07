import { z } from "zod";
import type { McpServer, AuthInfo } from "@modelcontextprotocol/server";
import { getProject, getBoundAgentId } from "./store.js";
import { actorBindingKey, actorBindingLookupKeys } from "./actor-binding.js";
import { createCapabilityGrant, listCapabilityGrants, revokeCapabilityGrant } from "./capability-store.js";
import { errorResult } from "./errors.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import type { CapabilityProvider } from "./capabilities.js";
import { runDiagnostics } from "./diagnostics.js";

type ToolExtra = { http?: { authInfo?: AuthInfo } };
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const rejected = (error: string, details?: unknown) => errorResult(error, details);

// Performance Optimization: Cache parsed grant admin subjects Set until CONDUIT_GRANT_ADMIN_SUBJECTS changes.
// Prevents re-parsing env string and instantiating a new Set on every .has() lookup inside isGrantAdmin().
let cachedAdminSubjectsEnv: string | undefined;
let cachedAdminSet: Set<string> | undefined;

function getGrantAdminSet(): Set<string> {
  const envSubjects = process.env.CONDUIT_GRANT_ADMIN_SUBJECTS ?? "";
  if (cachedAdminSet && cachedAdminSubjectsEnv === envSubjects) {
    return cachedAdminSet;
  }
  cachedAdminSubjectsEnv = envSubjects;
  cachedAdminSet = new Set(
    envSubjects
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return cachedAdminSet;
}

const actorSubject = (extra: ToolExtra) => {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  const sub = typeof info.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : undefined;
  const clientId = typeof info.clientId === "string" && info.clientId.length > 0 ? info.clientId : undefined;
  return actorBindingKey(clientId, sub);
};
async function governingAgent(extra: ToolExtra) {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  const sub = typeof info.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : undefined;
  const clientId = typeof info.clientId === "string" && info.clientId.length > 0 ? info.clientId : undefined;
  for (const key of actorBindingLookupKeys(clientId, sub)) {
    const bound = await getBoundAgentId(key);
    if (bound) return bound;
  }
  return actorSubject(extra);
}
/**
 * Grant-admin matching for CONDUIT_GRANT_ADMIN_SUBJECTS entries:
 *  - `client::sub`     composite key: that user of that OAuth client.
 *  - `sub`             bare value: matches the token's `sub`. For a client-credentials token
 *                      (no sub, or sub === clientId) it also matches the clientId, because the
 *                      client *is* the subject. It never admits other users of a client.
 *  - `client:<id>`     explicit client-scoped form: every subject of OAuth client <id>.
 *                      Reserved prefix: a token whose `sub` is literally `client:<id>` never
 *                      matches it as a bare subject (configure such a subject as `client::sub`).
 * Before this change a bare clientId admitted every user of that client (see #237).
 */
export function isGrantAdmin(extra: ToolExtra) {
  const info = extra.http?.authInfo;
  const rawSub = typeof info?.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : undefined;
  const clientId = typeof info?.clientId === "string" && info.clientId.length > 0 ? info.clientId : undefined;
  const adminSet = getGrantAdminSet();
  if (adminSet.size === 0 || (!rawSub && !clientId)) return false;
  if (clientId && adminSet.has(`client:${clientId}`)) return true;
  const clientIsSubject = !rawSub || rawSub === clientId;
  const subject = clientIsSubject ? clientId : rawSub;
  // `client:` is a reserved selector prefix: such entries never participate in bare-sub
  // matching, so a token whose sub is literally `client:<id>` cannot borrow a client grant.
  if (subject && !subject.startsWith("client:") && adminSet.has(subject)) return true;
  if (clientId && rawSub && !clientIsSubject && adminSet.has(`${clientId}::${rawSub}`)) return true;
  return false;
}

async function canGovern(extra: ToolExtra, projectId?: string) {
  if (isGrantAdmin(extra)) return true;
  if (!projectId) return false;
  const project = await getProject(projectId);
  return project?.createdBy === (await governingAgent(extra));
}

export function registerGrantTools(server: McpServer, authConfig?: ConduitAuthConfig) {
  const writeScope = authConfig?.writeScope;
  const readScope = authConfig?.readScope;

  server.registerTool("grant_create", { description: "Grant one logical agent narrowly scoped access to a configured external integration or MCP bridge target. Grants are deny-by-default and auditable.", inputSchema: z.object({ agentId: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional(), provider: z.enum(["github", "render", "supabase", "mcp_bridge"] as const), method: z.string().min(1).max(16), pathPattern: z.string().min(1).max(2000), expiresAt: z.string().datetime().optional() }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ agentId, projectId, provider, method, pathPattern, expiresAt }, extra) => {
    if (writeScope) requireScope(extra.http?.authInfo, writeScope);
    const extraAuth = extra as ToolExtra;
    if (!(await canGovern(extraAuth, projectId))) return rejected("grant_admin_required", { projectId: projectId ?? null });
    try {
      const creator = await governingAgent(extraAuth);
      if (!creator) return rejected("agent_identity_not_bound");
      return json(await createCapabilityGrant({ agentId, projectId, provider: provider as CapabilityProvider, method, pathPattern, expiresAt, createdBy: creator }));
    } catch (error) { return rejected(error instanceof Error ? error.message : "grant_create_failed"); }
  });

  server.registerTool("grant_revoke", { description: "Revoke an existing capability grant. Creators can revoke their own grants; configured grant administrators can revoke any grant.", inputSchema: z.object({ grantId: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional() }), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ grantId, projectId }, extra) => {
    if (writeScope) requireScope(extra.http?.authInfo, writeScope);
    const extraAuth = extra as ToolExtra;
    if (!(await canGovern(extraAuth, projectId))) return rejected("grant_admin_required", { projectId: projectId ?? null });
    const creator = await governingAgent(extraAuth);
    return creator && (await revokeCapabilityGrant(grantId, creator, { asAdmin: isGrantAdmin(extraAuth) })) ? json({ revoked: true, grantId }) : rejected("grant_not_found_or_not_owned", { grantId });
  });

  server.registerTool("grants_list", { description: "List capability grants visible to the caller. Revoked grants are excluded unless explicitly requested by a project owner or administrator.", inputSchema: z.object({ agentId: z.string().min(1).max(200).optional(), projectId: z.string().min(1).max(200).optional(), provider: z.enum(["github", "render", "supabase", "mcp_bridge"] as const).optional(), includeRevoked: z.boolean().optional() }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ agentId, projectId, provider, includeRevoked }, extra) => {
    if (readScope) requireScope(extra.http?.authInfo, readScope);
    const extraAuth = extra as ToolExtra;
    const callerAgent = await governingAgent(extraAuth);
    const isGovernor = await canGovern(extraAuth, projectId);

    if (includeRevoked && !isGovernor) return rejected("grant_admin_required", { projectId: projectId ?? null });

    let effectiveAgentId: string | undefined;
    if (isGovernor) {
      effectiveAgentId = agentId ?? callerAgent;
    } else {
      if (agentId && agentId !== callerAgent) {
        return rejected("grant_admin_required", { agentId });
      }
      effectiveAgentId = callerAgent;
    }

    if (!effectiveAgentId && !projectId) return rejected("grant_scope_required");
    return json(await listCapabilityGrants({ agentId: effectiveAgentId, projectId, provider: provider as CapabilityProvider | undefined, includeRevoked }));
  });

  server.registerTool("conduit_diagnostics", { description: "Run safe self-diagnostics for Conduit MCP/OAuth discovery, protected-resource metadata, authorization-server reachability, JWKS, scope parity, and CIMD/DCR advertisement. Never returns tokens or credentials.", inputSchema: z.object({ baseUrl: z.string().url().optional() }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ baseUrl }, extra) => {
    if (readScope) requireScope(extra.http?.authInfo, readScope);
    try { return json(await runDiagnostics(authConfig, baseUrl)); }
    catch (error) { return rejected("diagnostics_failed", { message: error instanceof Error ? error.message : "diagnostics_failed" }); }
  });
}
