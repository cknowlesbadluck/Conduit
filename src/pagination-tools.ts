import { z } from "zod";
import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { getCoordinationContext, listActivity, listAgents, listContacts, listProjects, listResources, listTasks, listTools } from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { errorResult } from "./errors.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import { pageFromWindow, pageWindow, paginate } from "./pagination.js";

type ToolExtra = { http?: { authInfo?: AuthInfo } };

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const auth = (extra: ToolExtra, scope: string) => requireScope(extra.http?.authInfo, scope);

export function registerPaginationTools(server: McpServer, authConfig?: ConduitAuthConfig) {
  const readScope = authConfig?.readScope;
  const schema = z.object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().max(200).optional() });

  async function boundedList<T>(limit: number | undefined, cursor: string | undefined, fetch: (window: { limit: number; offset: number }) => Promise<T[]>) {
    const window = pageWindow({ limit, cursor });
    const rows = await fetch({ limit: window.limit + 1, offset: window.offset });
    return json(pageFromWindow(rows, window.limit, window.offset));
  }

  server.registerTool("agents_list", { description: "List registered agents with bounded cursor pagination", inputSchema: schema, annotations: readOnly }, async ({ limit, cursor }, extra) => {
    if (readScope) auth(extra, readScope);
    return boundedList(limit, cursor, (bounds) => listAgents(bounds));
  });
  server.registerTool("projects_list", { description: "List Conduit projects with bounded cursor pagination", inputSchema: schema, annotations: readOnly }, async ({ limit, cursor }, extra) => {
    if (readScope) auth(extra, readScope);
    return boundedList(limit, cursor, (bounds) => listProjects(bounds));
  });
  server.registerTool("resources_list", { description: "List shared development resources with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ limit, cursor, projectId }, extra) => {
    if (readScope) auth(extra, readScope);
    return boundedList(limit, cursor, (bounds) => listResources(projectId, bounds));
  });
  server.registerTool("task_list", { description: "List tasks with filters and bounded cursor pagination", inputSchema: schema.extend({ status: z.enum(["open", "claimed", "blocked", "completed"]).optional(), projectId: z.string().min(1).optional(), claimedBy: z.string().min(1).optional(), createdBy: z.string().min(1).optional() }), annotations: readOnly }, async ({ status, projectId, claimedBy, createdBy, limit, cursor }, extra) => {
    if (readScope) auth(extra, readScope);
    return boundedList(limit, cursor, (bounds) => listTasks({ status, projectId, claimedBy, createdBy, ...bounds }));
  });
  server.registerTool("contacts_list", { description: "List shared contacts with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId, limit, cursor }, extra) => {
    if (readScope) auth(extra, readScope);
    return boundedList(limit, cursor, (bounds) => listContacts(projectId, bounds));
  });
  server.registerTool("tools_list", { description: "List shared tools and endpoints with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId, limit, cursor }, extra) => {
    if (readScope) auth(extra, readScope);
    return boundedList(limit, cursor, (bounds) => listTools(projectId, bounds));
  });
  server.registerTool("activity_list", { description: "List recent Conduit activity with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId, limit, cursor }, extra) => {
    if (readScope) auth(extra, readScope);
    return json(paginate(await listActivity(200, projectId), { limit, cursor }));
  });

  server.registerTool("conduit_context", { description: "Return a bounded snapshot of Conduit coordination state with per-section cursors", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId, limit, cursor }, extra) => {
    if (readScope) auth(extra, readScope);
    const coordination = await getCoordinationContext(projectId);
    if (!coordination) return errorResult("project_not_found", { projectId });
    const page = { limit, cursor };
    return json({
      conduit: getDevelopmentContext(),
      coordination: {
        ...coordination,
        agents: paginate(coordination.agents, page),
        tasks: paginate(coordination.tasks, page),
        contacts: paginate(coordination.contacts, page),
        tools: paginate(coordination.tools, page),
        resources: paginate(coordination.resources, page),
        activity: paginate(coordination.activity, page),
        projects: paginate(coordination.projects, page),
      },
    });
  });
}
