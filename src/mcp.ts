import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  registerAgent, getBoundAgentId, listAgents, createProject, listProjects, registerResource, listResources,
  createTask, listTasks, claimTask, completeTask, handoff, addContact, listContacts, registerTool, listTools,
  listActivity, getCoordinationContext,
} from "./store.js";
import { getDevelopmentContext } from "./development.js";
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
  if (!subject) return requested;
  const bound = await getBoundAgentId(subject);
  if (!bound || (requested && requested !== bound)) return null;
  return bound;
};
const rejected = (error: string) => ({ ...json({ error }), isError: true });

export function createConduitServer(authConfig?: ConduitAuthConfig) {
  const server = new McpServer({ name: "Conduit", version: "0.5.0", description: "Project-agnostic agent coordination and integration bridge" });
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

  server.registerTool("development_context", { description: "Return the canonical, project-agnostic purpose, scope, capabilities, and constraints of Conduit", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    return json(getDevelopmentContext());
  });

  server.registerTool("agent_register", { description: "Register a logical agent identity and bind it to the authenticated actor", inputSchema: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), description: z.string().max(2000).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ id, name, description }, extra) => {
    if (writeScope) auth(extra, writeScope);
    const actor = actorSubject(extra); const existing = actor ? await getBoundAgentId(actor) : undefined;
    if (actor && existing && existing !== id) return rejected("agent_identity_already_bound");
    const result = await registerAgent({ id, name, description, actorSubject: actor });
    return result ? json(result) : rejected("agent_identity_conflict");
  });

  server.registerTool("agents_list", { description: "List registered agents", inputSchema: z.object({}) }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(await listAgents()); });

  server.registerTool("project_create", { description: "Create a project coordination domain for shared development work", inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ name, description, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await createProject({ name, description, createdBy: actor }); return result ? json(result) : rejected("project_creator_not_registered");
  });

  server.registerTool("projects_list", { description: "List Conduit projects", inputSchema: z.object({}) }, async (_input, extra) => { if (readScope) auth(extra, readScope); return json(await listProjects()); });

  server.registerTool("resource_register", { description: "Register a shared development resource or integration reference", inputSchema: z.object({ projectId: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200), description: z.string().min(1).max(2000), kind: z.string().min(1).max(100), endpoint: z.string().url().optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ projectId, name, description, kind, endpoint, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerResource({ projectId, name, description, kind, endpoint, createdBy: actor }); return result ? json(result) : rejected(projectId ? "project_not_found_or_agent_unregistered" : "agent_unregistered");
  });

  server.registerTool("resources_list", { description: "List shared development resources", inputSchema: z.object({ projectId: z.string().min(1).optional() }) }, async ({ projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listResources(projectId)); });

  server.registerTool("task_create", { description: "Create a coordination task", inputSchema: z.object({ title: z.string().min(1).max(500), description: z.string().max(5000).optional(), createdBy: z.string().min(1).max(200).optional(), projectId: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async (input, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, input.createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await createTask({ ...input, createdBy: actor }); return result ? json(result) : rejected(input.projectId ? "project_not_found_or_agent_unregistered" : "creator_not_registered");
  });

  server.registerTool("task_list", { description: "List tasks, optionally filtered by status and project", inputSchema: z.object({ status: z.enum(["open", "claimed", "blocked", "completed"]).optional(), projectId: z.string().min(1).optional() }) }, async ({ status, projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listTasks(status, projectId)); });

  server.registerTool("task_claim", { description: "Atomically claim an open task as the authenticated agent", inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound_or_impersonation");
    const result = await claimTask(taskId, actor); return result ? json(result) : rejected("task_unavailable_or_agent_unregistered");
  });

  server.registerTool("task_complete", { description: "Complete a task claimed by the authenticated agent", inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1).optional() }), annotations: { destructiveHint: true, readOnlyHint: false } }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, agentId); if (!actor) return rejected("agent_identity_not_bound_or_impersonation");
    const result = await completeTask(taskId, actor); return result ? json(result) : rejected("task_not_owned_or_not_claimed");
  });

  server.registerTool("task_handoff", { description: "Hand a task from the authenticated agent to another registered agent", inputSchema: z.object({ taskId: z.string().min(1), fromAgent: z.string().min(1).optional(), toAgent: z.string().min(1), note: z.string().max(5000).optional() }), annotations: { destructiveHint: true, readOnlyHint: false } }, async (input, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, input.fromAgent); if (!actor) return rejected("agent_identity_not_bound_or_impersonation");
    const result = await handoff(input.taskId, actor, input.toAgent, input.note); return result ? json(result) : rejected("handoff_rejected");
  });

  server.registerTool("contact_add", { description: "Store a shared contact or project-scoped reference", inputSchema: z.object({ name: z.string().min(1).max(200), value: z.string().min(1).max(2000), kind: z.string().min(1).max(100), projectId: z.string().min(1).max(200).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ name, value, kind, projectId, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await addContact(name, value, kind, projectId, actor); return result ? json(result) : rejected("project_not_found_or_agent_unregistered");
  });

  server.registerTool("contacts_list", { description: "List shared contacts and references", inputSchema: z.object({ projectId: z.string().min(1).optional() }) }, async ({ projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listContacts(projectId)); });

  server.registerTool("tool_register", { description: "Register a shared tool or MCP endpoint", inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().min(1).max(2000), endpoint: z.string().url().optional(), projectId: z.string().min(1).max(200).optional(), createdBy: z.string().min(1).max(200).optional() }), annotations: { destructiveHint: false, readOnlyHint: false } }, async ({ name, description, endpoint, projectId, createdBy }, extra) => {
    if (writeScope) auth(extra, writeScope); const actor = await requireBoundAgent(extra, createdBy); if (!actor) return rejected("agent_identity_not_bound");
    const result = await registerTool(name, description, endpoint, projectId, actor); return result ? json(result) : rejected("project_not_found_or_agent_unregistered");
  });

  server.registerTool("tools_list", { description: "List shared tools and endpoints", inputSchema: z.object({ projectId: z.string().min(1).optional() }) }, async ({ projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listTools(projectId)); });
  server.registerTool("activity_list", { description: "List recent Conduit activity", inputSchema: z.object({ limit: z.number().int().min(1).max(200).optional(), projectId: z.string().min(1).optional() }) }, async ({ limit, projectId }, extra) => { if (readScope) auth(extra, readScope); return json(await listActivity(limit, projectId)); });

  return server;
}
