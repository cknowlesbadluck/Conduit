import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  registerAgent, getBoundAgentId, listAgents, createProject, listProjects, registerResource, listResources,
  getProject, createTask, getTask, listTasks, claimTask, blockTask, releaseTask, completeTask, handoff, addContact, listContacts, registerTool, listTools,
  listActivity, getCoordinationContext,
} from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { callIntegration, integrationMethods, integrationProviders, listIntegrations } from "./integrations.js";
import { callMcpBridge } from "./mcp-bridge.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import { VERSION, SERVICE_NAME } from "./version.js";
import { errorResult } from "./errors.js";
import { registerGrantTools } from "./grant-tools.js";
import { enforceExternalCapability } from "./external-policy.js";

export type ToolExtra = { http?: { authInfo?: AuthInfo } };

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
});
const auth = (extra: ToolExtra, scope: string) => requireScope(extra.http?.authInfo, scope);

export function actorSubject(extra: ToolExtra) {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  return typeof info.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : info.clientId;
}

const boundAgent = async (extra: ToolExtra) => {
  const subject = actorSubject(extra);
  return subject ? getBoundAgentId(subject) : undefined;
};

export async function resolveBoundAgent(extra: ToolExtra, requested?: string) {
  const subject = actorSubject(extra);
  if (!subject) return requested ?? null;
  const bound = await getBoundAgentId(subject);
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

  server.registerTool("conduit_context", { description: "Return the canonical Conduit purpose and a live snapshot of coordinated development state. Optional projectId filters the snapshot to one project.", inputSchema: z.object({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId }, extra) => {
    if (readScope) auth(extra, readScope);
    const coordination = await getCoordinationContext(projectId);
    return coordination ? json({ conduit: getDevelopmentContext(), coordination }) : rejected("project_not_found", { projectId });
  });

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

  server.registerTool("agents_list", { description: "List registered agents", inputSchema: z.object({}), annotations: readOnly }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(await listAgents()); });
  server.registerTool("project_create", { description: "Create a project coordination domain for shared development work", inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ name, description, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await createProject({ name, description, createdBy: actor }); return result ? json(result) : rejected("project_creator_not_registered");
  });
  server.registerTool("projects_list", { description: "List Conduit projects", inputSchema: z.object({}), annotations: readOnly }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(await listProjects()); });
  server.registerTool("project_get", { description: "Retrieve details of a single project by ID", inputSchema: z.object({ projectId: z.string().min(1) }), annotations: readOnly }, async ({ projectId }, extra) => {
    if (readScope) auth(extra, readScope);
    const result = await getProject(projectId);
    return result ? json(result) : rejected("project_not_found", { projectId });
  });

  server.registerTool("resource_register", { description: "Register a shared development resource or integration reference. This stores metadata only and does not grant Conduit permission to call the endpoint.", inputSchema: z.object({ projectId: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200), description: z.string().min(1).max(2000), kind: z.string().min(1).max(100), endpoint: z.string().url().optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ projectId, name, description, kind, endpoint, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerResource({ projectId, name, description, kind, endpoint, createdBy: actor }); return result ? json(result) : rejected(projectId ? "project_not_found_or_agent_unregistered" : "agent_unregistered");
  });
  server.registerTool("resources_list", { description: "List shared development resources", inputSchema: z.object({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listResources(projectId)); });

  server.registerTool("integrations_list", { description: "List supported runtime integrations and whether their server-side credentials are configured. Credential environment names are never returned.", inputSchema: z.object({}), annotations: readOnly }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(listIntegrations().map(({ credentialEnv: _credentialEnv, ...definition }) => definition)); });
  server.registerTool("integration_call", { description: "Call a configured GitHub, Render, or Supabase API through its authenticated Conduit adapter. GET/HEAD require read scope; mutations require write scope. Paths must be relative to the provider API root.", inputSchema: z.object({ provider: z.enum(integrationProviders), method: z.enum(integrationMethods), path: z.string().min(1).max(2000), body: z.unknown().optional(), projectId: z.string().min(1).max(200).optional() }), annotations: openWorldWrite }, async ({ provider, method, path, body, projectId }, extra) => {
    const isRead = method === "GET" || method === "HEAD";
    if (isRead) { if (readScope) auth(extra, readScope); } else { if (writeScope) auth(extra, writeScope); }
    try {
      const agentId = await resolveBoundAgent(extra);
      await enforceExternalCapability({ agentId: agentId ?? undefined, provider, method, path, projectId });
      const result = await callIntegration({ provider, method, path, body });
      console.info(JSON.stringify({ type: "integration.call", provider, method, path: result.path, status: result.status, ok: result.ok, projectId: projectId ?? null, actor: actorSubject(extra) ?? null }));
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

  server.registerTool("task_create", { description: "Create a coordination task. Uses the authenticated bound agent as creator.", inputSchema: z.object({ title: z.string().min(1).max(500), description: z.string().max(5000).optional(), createdBy: z.string().min(1).max(200).optional(), projectId: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async (input, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, input.createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await createTask({ ...input, createdBy: actor }); return result ? json(result) : rejected(input.projectId ? "project_not_found_or_agent_unregistered" : "creator_not_registered");
  });
  server.registerTool("task_list", { description: "List tasks, optionally filtered by status, project, claimant, or creator", inputSchema: z.object({ status: z.enum(["open", "claimed", "blocked", "completed"]).optional(), projectId: z.string().min(1).optional(), claimedBy: z.string().min(1).optional(), createdBy: z.string().min(1).optional() }), annotations: readOnly }, async ({ status, projectId, claimedBy, createdBy }, extra) => { if (readScope) auth(extra, readScope); return json(await listTasks({ status, projectId, claimedBy, createdBy })); });

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
  server.registerTool("contacts_list", { description: "List shared contacts and references", inputSchema: z.object({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listContacts(projectId)); });
  server.registerTool("tool_register", { description: "Register a shared tool or MCP endpoint. Registration is metadata only and does not authorize mcp_bridge_call against that URL.", inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().min(1).max(2000), endpoint: z.string().url().optional(), projectId: z.string().min(1).max(200).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: writeSafe }, async ({ name, description, endpoint, projectId, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await resolveBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerTool(name, description, endpoint, projectId, actor); return result ? json(result) : rejected("project_not_found_or_agent_unregistered");
  });
  server.registerTool("tools_list", { description: "List shared tools and endpoints", inputSchema: z.object({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listTools(projectId)); });
  server.registerTool("activity_list", { description: "List recent Conduit activity", inputSchema: z.object({ limit: z.number().int().min(1).max(200).optional(), projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ limit, projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listActivity(limit, projectId)); });

  registerGrantTools(server, authConfig);
  return server;
}
