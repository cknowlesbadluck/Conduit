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

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const auth = (extra: { http?: { authInfo?: AuthInfo } }, scope: string) => requireScope(extra.http?.authInfo, scope);
const actorSubject = (extra: { http?: { authInfo?: AuthInfo } }) => {
  const info = extra.http?.authInfo;
  if (!info) return undefined;
  return typeof info.extra?.sub === "string" && info.extra.sub.length > 0 ? info.extra.sub : info.clientId;
};
const boundAgent = async (extra: { http?: { authInfo?: AuthInfo } }) => {
  const subject = actorSubject(extra);
  return subject ? getBoundAgentId(subject) : undefined;
};
const requireBoundAgent = async (extra: { http?: { authInfo?: AuthInfo } }, requested?: string) => {
  const subject = actorSubject(extra);
  if (!subject) return null;
  const bound = await getBoundAgentId(subject);
  if (!bound || (requested && requested !== bound)) return null;
  return bound;
};
const rejected = (error: string) => ({ ...json({ error }), isError: true });

export function createConduitServer(authConfig?: ConduitAuthConfig) {
  const server = new McpServer({ name: "Conduit", version: "0.6.0", description: "Project-agnostic agent coordination and integration bridge" });
  const readScope = authConfig?.readScope;
  const writeScope = authConfig?.writeScope;

  server.registerTool("conduit_context", { description: "Return the canonical Conduit purpose and a live snapshot of coordinated development state", inputSchema: z.object({ projectId: z.string().min(1).optional() }), annotations: { readOnlyHint: true } }, async ({ projectId }, extra) => {
    if (readScope) auth(extra, readScope);
    const coordination = await getCoordinationContext(projectId);
    return coordination ? json({ conduit: getDevelopmentContext(), coordination }) : rejected("project_not_found");
  });

  server.registerTool("agent_identity", { description: "Return the authenticated agent identity and granted Conduit scopes", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    const info = extra.http?.authInfo;
    return json({ clientId: info?.clientId ?? "unknown", scopes: info?.scopes ?? [], subject: typeof info?.extra?.sub === "string" ? info.extra.sub : undefined, name: typeof info?.extra?.name === "string" ? info.extra.name : undefined, email: typeof info?.extra?.email === "string" ? info.extra.email : undefined, boundAgentId: await boundAgent(extra), expiresAt: info?.expiresAt });
  });

  server.registerTool("development_context", { description: "Return the canonical, project-agnostic purpose, scope, capabilities, and constraints of Conduit", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(getDevelopmentContext()); });

  server.registerTool("agent_register", { description: "Register a logical agent identity and bind it to the authenticated actor", inputSchema: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), description: z.string().max(2000).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ id, name, description }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = actorSubject(extra); const existing = actor ? await getBoundAgentId(actor) : undefined;
    if (actor && existing && existing !== id) return rejected("agent_identity_already_bound");
    const result = await registerAgent({ id, name, description, actorSubject: actor }); return result ? json(result) : rejected("agent_identity_conflict");
  });

  server.registerTool("agents_list", { description: "List registered agents", inputSchema: z.object({}) }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(await listAgents()); });
  server.registerTool("project_create", { description: "Create a project coordination domain for shared development work", inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ name, description, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await createProject({ name, description, createdBy: actor }); return result ? json(result) : rejected("project_creator_not_registered");
  });
  server.registerTool("projects_list", { description: "List Conduit projects", inputSchema: z.object({}) }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(await listProjects()); });
  server.registerTool("project_get", { description: "Retrieve details of a single project by ID", inputSchema: z.object({ projectId: z.string().min(1) }), annotations: { readOnlyHint: true } }, async ({ projectId }, extra) => {
    if (readScope) auth(extra, readScope);
    const result = await getProject(projectId);
    return result ? json(result) : rejected("project_not_found");
  });

  server.registerTool("resource_register", { description: "Register a shared development resource or integration reference", inputSchema: z.object({ projectId: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200), description: z.string().min(1).max(2000), kind: z.string().min(1).max(100), endpoint: z.string().url().optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ projectId, name, description, kind, endpoint, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerResource({ projectId, name, description, kind, endpoint, createdBy: actor }); return result ? json(result) : rejected(projectId ? "project_not_found_or_agent_unregistered" : "agent_unregistered");
  });
  server.registerTool("resources_list", { description: "List shared development resources", inputSchema: z.object({ projectId: z.string().min(1).optional() }) }, async ({ projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listResources(projectId)); });

  server.registerTool("integrations_list", { description: "List supported runtime integrations and whether their server-side credentials are configured", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(listIntegrations().map(({ credentialEnv: _credentialEnv, ...definition }) => definition)); });
  server.registerTool("integration_call", { description: "Call a configured GitHub, Render, or Supabase API through its authenticated Conduit adapter. GET/HEAD require read scope; mutations require write scope.", inputSchema: z.object({ provider: z.enum(integrationProviders), method: z.enum(integrationMethods), path: z.string().min(1).max(2000), body: z.unknown().optional(), projectId: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: true, readOnlyHint: false } }, async ({ provider, method, path, body, projectId }, extra) => {
    const isRead = method === "GET" || method === "HEAD";
    if (isRead) { if (readScope) auth(extra, readScope); } else { if (writeScope) auth(extra, writeScope); }
    try {
      const result = await callIntegration({ provider, method, path, body });
      console.info(JSON.stringify({ type: "integration.call", provider, method, path: result.path, status: result.status, ok: result.ok, projectId: projectId ?? null, actor: actorSubject(extra) ?? null }));
      return json(result);
    } catch (error) { const message = error instanceof Error ? error.message : "integration_call_failed"; console.warn(JSON.stringify({ type: "integration.call.failed", provider, method, path, projectId: projectId ?? null, actor: actorSubject(extra) ?? null, error: message })); return rejected(message); }
  });

  server.registerTool("mcp_bridge_call", { description: "Forward one JSON-RPC request to a remote MCP endpoint. Discovery/list methods require read scope; tools/call and other methods require write scope.", inputSchema: z.object({ endpoint: z.string().url(), method: z.string().min(1).max(200), id: z.union([z.string(), z.number(), z.null()]).optional(), params: z.unknown().optional(), projectId: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: true, readOnlyHint: false } }, async ({ endpoint, method, id, params, projectId }, extra) => {
    const readMethods = new Set(["initialize", "ping", "tools/list", "resources/list", "resources/templates/list", "prompts/list"]);
    if (readMethods.has(method)) { if (readScope) auth(extra, readScope); } else { if (writeScope) auth(extra, writeScope); }
    try {
      const result = await callMcpBridge({ endpoint, request: { jsonrpc: "2.0", id, method, params } });
      console.info(JSON.stringify({ type: "mcp.bridge.call", endpoint: new URL(endpoint).origin, method, status: result.status, ok: result.ok, projectId: projectId ?? null, actor: actorSubject(extra) ?? null }));
      return json(result);
    } catch (error) { const message = error instanceof Error ? error.message : "mcp_bridge_call_failed"; console.warn(JSON.stringify({ type: "mcp.bridge.call.failed", endpoint, method, projectId: projectId ?? null, actor: actorSubject(extra) ?? null, error: message })); return rejected(message); }
  });
