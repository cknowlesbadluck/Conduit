import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getCoordinationContext, listActivity, listAgents, listContacts, listProjects, listResources, listTasks, listTools } from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { errorResult } from "./errors.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";
import { paginate } from "./pagination.js";
import type { ToolExtra } from "./mcp.js";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const auth = (extra: ToolExtra, scope: string) => requireScope(extra.http?.authInfo, scope);

export function registerPaginationTools(server: McpServer, authConfig?: ConduitAuthConfig) {
  const readScope = authConfig?.readScope;
  const schema = z.object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().max(200).optional() });

  server.registerTool("agents_list", { description: "List registered agents with bounded cursor pagination", inputSchema: schema, annotations: readOnly }, async ({ limit, cursor }, extra) => { if (readScope) auth(extra, readScope); return json(paginate(await listAgents(), { limit, cursor })); });
  server.registerTool("projects_list", { description: "List Conduit projects with bounded cursor pagination", inputSchema: schema, annotations: readOnly }, async ({ limit, cursor }, extra) => { if (readScope) auth(extra, readScope); return json(paginate(await listProjects(), { limit, cursor })); });
  server.registerTool("resources_list", { description: "List shared development resources with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ limit, cursor, projectId }, extra) => { if (readScope) auth(extra, readScope); return json(paginate(await listResources(projectId), { limit, cursor })); });
  server.registerTool("task_list", { description: "List tasks with filters and bounded cursor pagination", inputSchema: schema.extend({ status: z.enum(["open", "claimed", "blocked", "completed"]).optional(), projectId: z.string().min(1).optional(), claimedBy: z.string().min(1).optional(), createdBy: z.string().min(1).optional() }), annotations: readOnly }, async ({ status, projectId, claimedBy, createdBy, limit, cursor }, extra) => { if (readScope) auth(extra, readScope); return json(paginate(await listTasks({ status, projectId, claimedBy, createdBy }), { limit, cursor })); });
  server.registerTool("contacts_list", { description: "List shared contacts with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId, limit, cursor }, extra) => { if (readScope) auth(extra, readScope); return json(paginate(await listContacts(projectId), { limit, cursor })); });
  server.registerTool("tools_list", { description: "List shared tools and endpoints with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId, limit, cursor }, extra) => { if (readScope) auth(extra, readScope); return json(paginate(await listTools(projectId), { limit, cursor })); });
  server.registerTool("activity_list", { description: "List recent Conduit activity with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async ({ projectId, limit, cursor }, extra) => { if (readScope) auth(extra, readScope); return json(paginate(await listActivity(200, projectId), { limit, cursor })); });

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
