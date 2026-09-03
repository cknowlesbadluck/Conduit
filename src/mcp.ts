import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  registerAgent,
  listAgents,
  createTask,
  listTasks,
  claimTask,
  completeTask,
  handoff,
  addContact,
  listContacts,
  registerTool,
  listTools,
  listActivity,
  getCoordinationContext,
} from "./store.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const auth = (extra: { http?: { authInfo?: AuthInfo } }, scope: string) => requireScope(extra.http?.authInfo, scope);

export function createConduitServer(authConfig?: ConduitAuthConfig) {
  const server = new McpServer({ name: "Conduit", version: "0.2.0", description: "Agent coordination and integration bridge" });
  const readScope = authConfig?.readScope;
  const writeScope = authConfig?.writeScope;

  server.registerTool("agent_identity", {
    description: "Return the authenticated agent identity and granted Conduit scopes",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    const info = extra.http?.authInfo;
    return json({
      clientId: info?.clientId ?? "unknown",
      scopes: info?.scopes ?? [],
      subject: typeof info?.extra?.sub === "string" ? info.extra.sub : undefined,
      name: typeof info?.extra?.name === "string" ? info.extra.name : undefined,
      email: typeof info?.extra?.email === "string" ? info.extra.email : undefined,
      expiresAt: info?.expiresAt,
    });
  });

  server.registerTool("conduit_context", {
    description: "Return a unified snapshot of agents, tasks, shared resources, tools, and recent activity",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    return json(await getCoordinationContext());
  });

  server.registerTool("agent_register", {
    description: "Register an agent with Conduit",
    inputSchema: z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().optional() }),
    annotations: { destructiveHint: false, readOnlyHint: false },
  }, async ({ id, name, description }, extra) => {
    if (writeScope) auth(extra, writeScope);
    return json(await registerAgent({ id, name, description }));
  });

  server.registerTool("agents_list", { description: "List registered agents", inputSchema: z.object({}) }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    return json(await listAgents());
  });

  server.registerTool("task_create", {
    description: "Create a coordination task",
    inputSchema: z.object({ title: z.string().min(1), description: z.string().optional(), createdBy: z.string().min(1) }),
    annotations: { destructiveHint: false, readOnlyHint: false },
  }, async (input, extra) => {
    if (writeScope) auth(extra, writeScope);
    const result = await createTask(input);
    return result ? json(result) : { ...json({ error: "creator_not_registered" }), isError: true };
  });

  server.registerTool("task_list", { description: "List tasks, optionally filtered by status", inputSchema: z.object({ status: z.enum(["open", "claimed", "blocked", "completed"]).optional() }) }, async ({ status }, extra) => {
    if (readScope) auth(extra, readScope);
    return json(await listTasks(status));
  });

  server.registerTool("task_claim", {
    description: "Atomically claim an open task",
    inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1) }),
    annotations: { destructiveHint: false, readOnlyHint: false },
  }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope);
    const result = await claimTask(taskId, agentId);
    return result ? json(result) : { ...json({ error: "task_unavailable_or_agent_unregistered" }), isError: true };
  });

  server.registerTool("task_complete", {
    description: "Complete a task claimed by the calling agent",
    inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1) }),
    annotations: { destructiveHint: true, readOnlyHint: false },
  }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope);
    const result = await completeTask(taskId, agentId);
    return result ? json(result) : { ...json({ error: "task_not_owned_or_not_claimed" }), isError: true };
  });

  server.registerTool("task_handoff", {
    description: "Hand a task from its current agent to another agent",
    inputSchema: z.object({ taskId: z.string().min(1), fromAgent: z.string().min(1), toAgent: z.string().min(1), note: z.string().optional() }),
    annotations: { destructiveHint: true, readOnlyHint: false },
  }, async (input, extra) => {
    if (writeScope) auth(extra, writeScope);
    const result = await handoff(input.taskId, input.fromAgent, input.toAgent, input.note);
    return result ? json(result) : { ...json({ error: "handoff_rejected" }), isError: true };
  });

  server.registerTool("contact_add", {
    description: "Store a shared contact or resource reference",
    inputSchema: z.object({ name: z.string().min(1), value: z.string().min(1), kind: z.string().min(1) }),
    annotations: { destructiveHint: false, readOnlyHint: false },
  }, async ({ name, value, kind }, extra) => {
    if (writeScope) auth(extra, writeScope);
    return json(await addContact(name, value, kind));
  });

  server.registerTool("contacts_list", { description: "List shared contacts and resource references", inputSchema: z.object({}) }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    return json(await listContacts());
  });

  server.registerTool("tool_register", {
    description: "Register a shared tool or MCP endpoint",
    inputSchema: z.object({ name: z.string().min(1), description: z.string().min(1), endpoint: z.string().url().optional() }),
    annotations: { destructiveHint: false, readOnlyHint: false },
  }, async ({ name, description, endpoint }, extra) => {
    if (writeScope) auth(extra, writeScope);
    return json(await registerTool(name, description, endpoint));
  });

  server.registerTool("tools_list", { description: "List shared tools and endpoints", inputSchema: z.object({}) }, async (_input, extra) => {
    if (readScope) auth(extra, readScope);
    return json(await listTools());
  });

  server.registerTool("activity_list", { description: "List recent Conduit activity", inputSchema: z.object({ limit: z.number().int().min(1).max(200).optional() }) }, async ({ limit }, extra) => {
    if (readScope) auth(extra, readScope);
    return json(await listActivity(limit));
  });

  return server;
}
