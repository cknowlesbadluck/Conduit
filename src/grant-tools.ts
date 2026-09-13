import { z } from "zod";
import type { McpServer, AuthInfo } from "@modelcontextprotocol/server";
import { getProject, getBoundAgentId } from "./store.js";
import { createCapabilityGrant, listCapabilityGrants, revokeCapabilityGrant } from "./capability-store.js";
import { errorResult } from "./errors.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import type { CapabilityProvider } from "./capabilities.js";
import { registerPaginationTools } from "./pagination-tools.js";

type ToolExtra = { http?: { authInfo?: AuthInfo } };
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const rejected = (error: string, details?: unknown) => errorResult(error, details);
const admins = () => new Set((process.env.CONDUIT_GRANT_ADMIN_SUBJECTS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const actorSubject = (extra: ToolExtra) => {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  return typeof info.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : info.clientId;
};

async function governingAgent(subject: string | undefined) { return subject ? (await getBoundAgentId(subject)) ?? subject : undefined; }
async function canGovern(subject: string | undefined, projectId?: string) {
  if (!subject) return false;
  if (admins().has(subject)) return true;
  if (!projectId) return false;
  const project = await getProject(projectId);
  return project?.createdBy === (await governingAgent(subject));
}

export function registerGrantTools(server: McpServer, authConfig?: ConduitAuthConfig) {
  const writeScope = authConfig?.writeScope;
  const readScope = authConfig?.readScope;

  server.registerTool("grant_create", { description: "Grant one logical agent narrowly scoped access to a configured external integration or MCP bridge target. Grants are deny-by-default and auditable.", inputSchema: z.object({ agentId: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional(), provider: z.enum(["github", "render", "supabase", "mcp_bridge"] as const), method: z.string().min(1).max(16), pathPattern: z.string().min(1).max(2000), expiresAt: z.string().datetime().optional() }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }, async ({ agentId, projectId, provider, method, pathPattern, expiresAt }, extra) => {
    if (writeScope) requireScope(extra.http?.authInfo, writeScope);
    const subject = actorSubject(extra as ToolExtra);
    if (!(await canGovern(subject, projectId))) return rejected("grant_admin_required", { projectId: projectId ?? null });
    try {
      const creator = await governingAgent(subject);
      if (!creator) return rejected("agent_identity_not_bound");
      return json(await createCapabilityGrant({ agentId, projectId, provider: provider as CapabilityProvider, method, pathPattern, expiresAt, createdBy: creator }));
    } catch (error) { return rejected(error instanceof Error ? error.message : "grant_create_failed"); }
  });

  server.registerTool("grant_revoke", { description: "Revoke an existing capability grant. Project owners and configured grant administrators can revoke grants they govern.", inputSchema: z.object({ grantId: z.string().min(1).max(200), projectId: z.string().min(1).max(200).optional() }), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ grantId, projectId }, extra) => {
    if (writeScope) requireScope(extra.http?.authInfo, writeScope);
    const subject = actorSubject(extra as ToolExtra);
    if (!(await canGovern(subject, projectId))) return rejected("grant_admin_required", { projectId: projectId ?? null });
    const creator = await governingAgent(subject);
    return creator && (await revokeCapabilityGrant(grantId, creator)) ? json({ revoked: true, grantId }) : rejected("grant_not_found_or_not_owned", { grantId });
  });

  server.registerTool("grants_list", { description: "List capability grants visible to the caller. Revoked grants are excluded unless explicitly requested by a project owner or administrator.", inputSchema: z.object({ agentId: z.string().min(1).max(200).optional(), projectId: z.string().min(1).max(200).optional(), provider: z.enum(["github", "render", "supabase", "mcp_bridge"] as const).optional(), includeRevoked: z.boolean().optional() }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ agentId, projectId, provider, includeRevoked }, extra) => {
    if (readScope) requireScope(extra.http?.authInfo, readScope);
    const subject = actorSubject(extra as ToolExtra);
    if (includeRevoked && !(await canGovern(subject, projectId))) return rejected("grant_admin_required", { projectId: projectId ?? null });
    const effectiveAgentId = agentId ?? await governingAgent(subject);
    if (!effectiveAgentId && !projectId) return rejected("grant_scope_required");
    return json(await listCapabilityGrants({ agentId: effectiveAgentId, projectId, provider: provider as CapabilityProvider | undefined, includeRevoked }));
  });

  registerPaginationTools(server, authConfig);
}
