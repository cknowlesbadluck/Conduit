function sanitizeForLog(text: string): string {
  return text.replace(/([?&](?:token|key|secret|auth|code|password|access_token|api_key|apikey)=)[^&]*/gi, "$1[REDACTED]");
}
import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  registerAgent, getBoundAgentId, createProject, registerResource,
  getProject, archiveProject, archiveResource, createTask, getTask, claimTask, blockTask, releaseTask, completeTask, handoff, addContact, registerTool,
  archiveContact, archiveTool, pruneActivity,
} from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { callIntegration, integrationMethods, integrationProviders, listIntegrations } from "./integrations.js";
import { callMcpBridge } from "./mcp-bridge.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { errorResult } from "./errors.js";
import { isGrantAdmin, registerGrantTools } from "./grant-tools.js";
import { registerPaginationTools } from "./pagination-tools.js";
import { enforceExternalCapability } from "./external-policy.js";
import { actorBindingKey, actorBindingLookupKeys } from "./actor-binding.js";

/** Soft-gate for cross-project / GATE-style tasks. Returns a warning string when the convention is incomplete; never blocks creation. */
export function assessTaskConvention(title: string, description?: string): string | undefined {
  const t = title.trim();
  const d = description ?? "";
  const looksLikeGate =
    /^GATE:/i.test(t) ||
    /MASTER\s+ROADMAP/i.test(t) ||
    /release\s+gate/i.test(t) ||
    /cross-project/i.test(t);
  if (!looksLikeGate) return undefined;
  const hasDepends = /DEPENDS:\s*\S+/i.test(d);
  const hasCriteria = /GATE-CRITERIA:\s*\S+/i.test(d);
  if (hasDepends && hasCriteria) return undefined;
  return "convention_warning: GATE-style or cross-project tasks should include DEPENDS: and GATE-CRITERIA: lines (see resource Cross-project release-gate convention). Task was still created.";
}

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
  server.registerTool("project_archive", { description: "Archive a project. Allowed for the creator or a grant admin. Tombstone only; records are not hard-deleted.", inputSchema: z.object({ projectId: z.string().min(1), agentId: z.string().min(1).max(200).optional() }), annotations: writeIdempotent }, async ({ projectId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound");
    const result = await archiveProject(projectId, actor, { asAdmin: isGrantAdmin(extra) }); return result ? json(result) : rejected("project_not_found_or_not_owned", { projectId });
  });

  server.registerTool("resource_register", { description: "Register a shared development resource or integration reference. This stores metadata only and does not grant Conduit permission to call the endpoint.", inputSchema: z.object({ projectId: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200), description: z.string().min(1).max(2000), kind: z.string().min(1).max(100), endpoint: z.string().url().optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ projectId, name, description, kind, endpoint, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerResource({ projectId, name, description, kind, endpoint, createdBy: actor }); return result ? json(result) : rejected(projectId ? "project_not_found_or_agent_unregistered" : "agent_unregistered");
  });
  server.registerTool("resource_archive", { description: "Archive a resource. Allowed for the creator, the parent project creator, or a grant admin. Tombstone only; records are not hard-deleted.", inputSchema: z.object({ resourceId: z.string().min(1), agentId: z.string().min(1).max(200).optional() }), annotations: writeIdempotent }, async ({ resourceId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound");
    const result = await archiveResource(resourceId, actor, { asAdmin: isGrantAdmin(extra) }); return result ? json(result) : rejected("resource_not_found_or_not_owned", { resourceId });
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
    } catch (error) { const message = error instanceof Error ? error.message : "integration_call_failed"; console.warn(JSON.stringify({ type: "integration.call.failed", provider, method, path, projectId: projectId ?? null, actor: actorSubject(extra) ?? null, error: message })); return rejected(message === "capability_denied" ? "capability_denied" : "integration_call_failed", { message }); }
  });

  server.registerTool("mcp_bridge_call", { description: "Forward one JSON-RPC request to a remote HTTPS MCP endpoint. Discovery/list methods require read scope; tools/call and other methods require write scope. Private, loopback, and link-local targets are rejected, DNS is pinned after validation, and redirects are not followed.", inputSchema: z.object({ endpoint: z.string().url(), method: z.string().min(1).max(200), id: z.union([z.string(), z.number(), z.null()]).optional(), params: z.unknown().optional(), projectId: z.string().min(1).max(200).optional() }), annotations: openWorldWrite }, async ({ endpoint, method, id, params, projectId }, extra) => {
    const readMethods = new Set(["initialize", "notifications/initialized", "ping", "tools/list", "resources/list", "resources/templates/list", "prompts/list", "resources/read"]);
    if (readMethods.has(method)) { if (readScope) auth(extra, readScope); } else { if (writeScope) auth(extra, writeScope); }
    try {
      const target = new URL(endpoint);
      const agentId = await resolveBoundAgent(extra);
      await enforceExternalCapability({ agentId: agentId ?? undefined, provider: "mcp_bridge", method, path: `${target.origin}${target.pathname}${target.search}`, projectId });
      const result = await callMcpBridge({ endpoint, request: { jsonrpc: "2.0", id, method, params } });
      console.info(JSON.stringify({ type: "mcp.bridge.call", endpoint: target.origin, method, status: result.status, ok: result.ok, projectId: projectId ?? null, actor: actorSubject(extra) ?? null }));
      return json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "mcp_bridge_call_failed";
      let origin: string | null = null;
      try { origin = new URL(endpoint).origin; } catch { origin = null; }
      console.warn(JSON.stringify({ type: "mcp.bridge.call.failed", endpoint: origin, method, projectId: projectId ?? null, actor: actorSubject(extra) ?? null, error: message }));
      return rejected(message === "capability_denied" ? "capability_denied" : "mcp_bridge_call_failed", { message });
    }
  });

  server.registerTool("task_create", { description: "Create a coordination task. Uses the authenticated bound agent as creator. GATE-style titles emit a soft convention_warning when DEPENDS:/GATE-CRITERIA: are missing; creation is never blocked.", inputSchema: z.object({ title: z.string().min(1).max(500), description: z.string().max(5000).optional(), createdBy: z.string().min(1).max(200).optional(), projectId: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async (input, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, input.createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await createTask({ ...input, createdBy: actor });
    if (!result) return rejected(input.projectId ? "project_not_found_or_agent_unregistered" : "creator_not_registered");
    const warning = assessTaskConvention(input.title, input.description);
    return json(warning ? { ...result, conventionWarning: warning } : result);
  });

  server.registerTool("task_get", { description: "Retrieve details of a single task by ID", inputSchema: z.object({ taskId: z.string().min(1) }), annotations: readOnly }, async ({ taskId }, extra) => {
    if (readScope) auth(extra, readScope);
    const result = await getTask(taskId);
    return result ? json(result) : rejected("task_not_found", { taskId });
  });

  server.registerTool("task_block", { description: "Mark a claimed task as blocked with an optional reason", inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1).optional(), reason: z.string().max(2000).optional() }), annotations: writeSafe }, async ({ taskId, agentId, reason }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound_or_impersonation", { requestedAgentId: agentId });
    const result = await blockTask(taskId, actor, reason); return result ? json(result) : rejected("task_not_claimed_by_agent", { taskId });
  });

  server.registerTool("task_release", { description: "Release a claimed or blocked task back to open status", inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1).optional() }), annotations: writeSafe }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound_or_impersonation", { requestedAgentId: agentId });
    const result = await releaseTask(taskId, actor); return result ? json(result) : rejected("task_not_owned_or_not_releasable", { taskId });
  });
  server.registerTool("task_claim", { description: "Atomically claim an open task as the authenticated agent", inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1).optional() }), annotations: writeSafe }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound_or_impersonation", { requestedAgentId: agentId });
    const result = await claimTask(taskId, actor); return result ? json(result) : rejected("task_unavailable_or_agent_unregistered", { taskId });
  });
  server.registerTool("task_complete", { description: "Complete a task claimed by the authenticated agent", inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1).optional() }), annotations: writeDestructive }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound_or_impersonation", { requestedAgentId: agentId });
    const result = await completeTask(taskId, actor); return result ? json(result) : rejected("task_not_owned_or_not_claimed", { taskId });
  });
  server.registerTool("task_handoff", { description: "Hand a task from the authenticated agent to another registered agent", inputSchema: z.object({ taskId: z.string().min(1), fromAgent: z.string().min(1).optional(), toAgent: z.string().min(1), note: z.string().max(5000).optional() }), annotations: writeDestructive }, async (input, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, input.fromAgent); if (!actor) return rejected("agent_identity_not_bound_or_impersonation", { requestedAgentId: input.fromAgent });
    const result = await handoff(input.taskId, actor, input.toAgent, input.note); return result ? json(result) : rejected("handoff_rejected", { taskId: input.taskId, toAgent: input.toAgent });
  });
  server.registerTool("contact_add", { description: "Store a shared contact or project-scoped reference. Do not store secrets.", inputSchema: z.object({ name: z.string().min(1).max(200), value: z.string().min(1).max(2000), kind: z.string().min(1).max(100), projectId: z.string().min(1).max(200).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ name, value, kind, projectId, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await addContact(name, value, kind, projectId, actor); return result ? json(result) : rejected("project_not_found_or_agent_unregistered");
  });
  server.registerTool("tool_register", { description: "Register a shared tool or MCP endpoint. Registration is metadata only and does not authorize mcp_bridge_call against that URL.", inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().min(1).max(2000), endpoint: z.string().url().optional(), projectId: z.string().min(1).max(200).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ name, description, endpoint, projectId, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerTool(name, description, endpoint, projectId, actor); return result ? json(result) : rejected("project_not_found_or_agent_unregistered");
  });
  server.registerTool("contact_archive", { description: "Archive a contact. Allowed for the creator, the parent project creator, or a grant admin. Legacy contacts with no recorded creator have no owner to protect, so any registered agent may archive them. Tombstone only; records are not hard-deleted.", inputSchema: z.object({ contactId: z.string().min(1), agentId: z.string().min(1).max(200).optional() }), annotations: writeIdempotent }, async ({ contactId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound");
    const result = await archiveContact(contactId, actor, { asAdmin: isGrantAdmin(extra) }); return result ? json(result) : rejected("contact_not_found_or_not_owned", { contactId });
  });
  server.registerTool("tool_archive", { description: "Archive a shared tool/endpoint registration. Allowed for the creator, the parent project creator, or a grant admin. Legacy entries with no recorded creator have no owner to protect, so any registered agent may archive them. Tombstone only; records are not hard-deleted.", inputSchema: z.object({ toolId: z.string().min(1), agentId: z.string().min(1).max(200).optional() }), annotations: writeIdempotent }, async ({ toolId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound");
    const result = await archiveTool(toolId, actor, { asAdmin: isGrantAdmin(extra) }); return result ? json(result) : rejected("tool_not_found_or_not_owned", { toolId });
  });
  server.registerTool("activity_prune", { description: "Delete old activity/audit rows beyond the retention window (env CONDUIT_ACTIVITY_RETENTION, default 5000 most recent), keeping the store from growing unbounded. Returns the number of rows removed; a no-op in in-memory mode, where retention is enforced automatically on write.", inputSchema: z.object({}), annotations: writeDestructive }, async (_input, extra) => {
    if (writeScope) auth(extra, writeScope);
    const removed = await pruneActivity();
    return json({ removed });
  });

  registerGrantTools(server, authConfig);
  registerPaginationTools(server, authConfig);
  return server;
}
