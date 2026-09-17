function sanitizeForLog(text: string): string {
  return text.replace(/([?&](?:token|key|secret|auth|code|password|access_token|api_key|apikey)=)[^&]*/gi, "$1[REDACTED]");
}
import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  registerAgent, getBoundAgentId, createProject, registerResource,
  getProject, archiveProject, archiveResource, createTask, getTask, claimTask, blockTask, releaseTask, completeTask, handoff, addContact, registerTool,
} from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { callIntegration, integrationMethods, integrationProviders, listIntegrations } from "./integrations.js";
import { callMcpBridge } from "./mcp-bridge.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { errorResult } from "./errors.js";
import { registerGrantTools } from "./grant-tools.js";
import { registerPaginationTools } from "./pagination-tools.js";
import { enforceExternalCapability } from "./external-policy.js";
import { actorBindingKey, actorBindingLookupKeys } from "./actor-binding.js";

export type ToolExtra = { http?: { authInfo?: AuthInfo } };

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
});
const auth = (extra: ToolExtra, scope: string) => requireScope(extra.http?.authInfo, scope);

export function oauthSubject(extra: ToolExtra) {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  return typeof info.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : undefined;
}

export function actorSubject(extra: ToolExtra) {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  const sub = oauthSubject(extra);
  const clientId = typeof info.clientId === "string" && info.clientId.length > 0 ? info.clientId : undefined;
  return actorBindingKey(clientId, sub);
}

const boundAgent = async (extra: ToolExtra) => {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  const sub = oauthSubject(extra);
  const clientId = typeof info.clientId === "string" && info.clientId.length > 0 ? info.clientId : undefined;
  for (const key of actorBindingLookupKeys(clientId, sub)) {
    const bound = await getBoundAgentId(key);
    if (bound) return bound;
  }
  return undefined;
};

export async function resolveBoundAgent(extra: ToolExtra, requested?: string) {
  const info = extra.http?.authInfo;
  if (!info) return requested ?? null;
  const bound = await boundAgent(extra);
  if (!bound || (requested && requested !== bound)) return null;
  return bound;
}

const rejected = (error: string, details?: unknown) => errorResult(error, details);

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const writeSafe = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const writeIdempotent = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const writeDestructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const openWorldWrite = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

export function createConduitServer(authConfig?: ConduitAuthConfig) {
  const server = new McpServer({ name: SERVICE_NAME, version: VERSION, description: "Project-agnostic agent coordination and integration bridge" });
  const readScope = authConfig?.readScope;
  const writeScope = authConfig?.writeScope;

  server.registerTool("agent_identity", { description: "Return the authenticated actor, granted Conduit scopes, and bound logical agent id when one exists.", inputSchema: z.object({}), annotations: readOnly }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    const info = extra.http?.authInfo;
    return json({ clientId: info?.clientId ?? "unknown", scopes: info?.scopes ?? [], subject: typeof info?.extra?.sub === "string" ? info.extra.sub : undefined, name: typeof info?.extra?.name === "string" ? info.extra.name : undefined, email: typeof info?.extra?.email === "string" ? info.extra.email : undefined, boundAgentId: await boundAgent(extra), expiresAt: info?.expiresAt });
  });

  server.registerTool("development_context", { description: "Return the canonical, project-agnostic purpose, scope, capabilities, and constraints of Conduit", inputSchema: z.object({}), annotations: readOnly }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(getDevelopmentContext()); });

  server.registerTool("agent_register", { description: "Register a logical agent identity and bind it to the authenticated actor. Subsequent writes use this bound identity.", inputSchema: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), description: z.string().max(2000).optional() }), annotations: writeIdempotent }, async ({ id, name, description }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = actorSubject(extra); const existing = actor ? await getBoundAgentId(actor) : undefined;
    if (actor && existing && existing !== id) return rejected("agent_identity_already_bound", { boundAgentId: existing, requestedAgentId: id });
    const result = await registerAgent({ id, name, description, actorSubject: actor }); return result ? json(result) : rejected("agent_identity_conflict", { agentId: id });
  });

  server.registerTool("project_create", { description: "Create a project coordination domain for shared development work", inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ name, description, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await createProject({ name, description, createdBy: actor }); return result ? json(result) : rejected("project_creator_not_registered");
  });
  server.registerTool("project_get", { description: "Retrieve details of a single project by ID", inputSchema: z.object({ projectId: z.string().min(1) }), annotations: readOnly }, async ({ projectId }, extra) => {
    if (readScope) auth(extra, readScope);
    const result = await getProject(projectId);
    return result ? json(result) : rejected("project_not_found", { projectId });
  });
  server.registerTool("project_archive", { description: "Archive a project created by the authenticated agent. Tombstone only; records are not hard-deleted.", inputSchema: z.object({ projectId: z.string().min(1), agentId: z.string().min(1).max(200).optional() }), annotations: writeIdempotent }, async ({ projectId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound");
    const result = await archiveProject(projectId, actor); return result ? json(result) : rejected("project_not_found_or_not_owned", { projectId });
  });

  server.registerTool("resource_register", { description: "Register a shared development resource or integration reference. This stores metadata only and does not grant Conduit permission to call the endpoint.", inputSchema: z.object({ projectId: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200), description: z.string().min(1).max(2000), kind: z.string().min(1).max(100), endpoint: z.string().url().optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ projectId, name, description, kind, endpoint, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerResource({ projectId, name, description, kind, endpoint, createdBy: actor }); return result ? json(result) : rejected(projectId ? "project_not_found_or_agent_unregistered" : "agent_unregistered");
  });
  server.registerTool("resource_archive", { description: "Archive a resource created by the authenticated agent. Tombstone only; records are not hard-deleted.", inputSchema: z.object({ resourceId: z.string().min(1), agentId: z.string().min(1).max(200).optional() }), annotations: writeIdempotent }, async ({ resourceId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound");
    const result = await archiveResource(resourceId, actor); return result ? json(result) : rejected("resource_not_found_or_not_owned", { resourceId });
  });

  server.registerTool("integrations_list", { description: "List supported runtime integrations and whether their server-side credentials are configured. Credential environment names are never returned.", inputSchema: z.object({}), annotations: readOnly }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(listIntegrations().map(({ credentialEnv: _credentialEnv, ...definition }) => definition)); });
  server.registerTool("integration_call", { description: "Call a configured GitHub, Render, or Supabase API through its authenticated Conduit adapter. GET/HEAD require read scope; mutations require write scope. Paths must be relative to the provider API root.", inputSchema: z.object({ provider: z.enum(integrationProviders), method: z.enum(integrationMethods), path: z.string().min(1).max(2000), body: z.unknown().optional(), projectId: z.string().min(1).max(200).optional() }), annotations: openWorldWrite }, async ({ provider, method, path, body, projectId }, extra) => {
    const isRead = method === "GET" || method === "HEAD";
    if (isRead) { if (readScope) auth(extra, readScope); } else { if (writeScope) auth(extra, writeScope); }
    try {
      const agentId = await resolveBoundAgent(extra);
      await enforceExternalCapability({ agentId: agentId ?? undefined, provider, method, path, projectId });
      const result = await callIntegration({ provider, method, path, body });
      console.info(JSON.stringify({ type: "integration.call", provider, method, path: sanitizeForLog(result.path), status: result.status, ok: result.ok, projectId: projectId ?? null, actor: actorSubject(extra) ?? null }));
      return json(result);
    } catch (error) { const message = error instanceof Error ? error.message : "integration_call_failed"; console.warn(JSON.stringify({ type: "integration.call.failed", provider, method, path, projectId: projectId ?? null, actor: actorSubject(extra) ?? null, error : message })); return rejected(message === "capability_denied" ? "capability_denied" : "integration_call_failed", { message }); }
  });
}
