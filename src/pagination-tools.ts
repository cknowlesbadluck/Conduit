import { z } from "zod";
import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { getProject, listActivityPage, listAgentsPage, listContactsPage, listProjectsPage, listResourcesPage, listTasksPage, listToolsPage } from "./store.js";
import { getDevelopmentContext } from "./development.js";
import { errorResult } from "./errors.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";

type ToolExtra = { http?: { authInfo?: AuthInfo } };

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const auth = (extra: ToolExtra, scope: string) => requireScope(extra.http?.authInfo, scope);

export function registerPaginationTools(server: McpServer, authConfig?: ConduitAuthConfig) {
  const readScope = authConfig?.readScope;
  const schema = z.object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().max(2000).optional() });

  server.registerTool("agents_list", { description: "List registered agents with bounded cursor pagination", inputSchema: schema, annotations: readOnly }, async (input, extra) => { if (readScope) auth(extra, readScope); return json(await listAgentsPage(input)); });
  server.registerTool("projects_list", { description: "List Conduit projects with bounded cursor pagination", inputSchema: schema, annotations: readOnly }, async (input, extra) => { if (readScope) auth(extra, readScope); return json(await listProjectsPage(input)); });
  server.registerTool("resources_list", { description: "List shared development resources with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async (input, extra) => { if (readScope) auth(extra, readScope); return json(await listResourcesPage(input)); });
  server.registerTool("task_list", { description: "List tasks with filters and bounded cursor pagination", inputSchema: schema.extend({ status: z.enum(["open", "claimed", "blocked", "completed"]).optional(), projectId: z.string().min(1).optional(), claimedBy: z.string().min(1).optional(), createdBy: z.string().min(1).optional() }), annotations: readOnly }, async (input, extra) => { if (readScope) auth(extra, readScope); return json(await listTasksPage(input)); });
  server.registerTool("contacts_list", { description: "List shared contacts with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async (input, extra) => { if (readScope) auth(extra, readScope); return json(await listContactsPage(input)); });
  server.registerTool("tools_list", { description: "List shared tools and endpoints with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async (input, extra) => { if (readScope) auth(extra, readScope); return json(await listToolsPage(input)); });
  server.registerTool("activity_list", { description: "List recent Conduit activity with bounded cursor pagination", inputSchema: schema.extend({ projectId: z.string().min(1).optional() }), annotations: readOnly }, async (input, extra) => { if (readScope) auth(extra, readScope); return json(await listActivityPage(input)); });

  const contextSchema = schema.extend({
    projectId: z.string().min(1).optional(),
    cursors: z.object({
      agents: z.string().max(2000).optional(),
      tasks: z.string().max(2000).optional(),
      contacts: z.string().max(2000).optional(),
      tools: z.string().max(2000).optional(),
      resources: z.string().max(2000).optional(),
      activity: z.string().max(2000).optional(),
      projects: z.string().max(2000).optional(),
    }).optional(),
  });

  server.registerTool("conduit_context", { description: "Return a bounded snapshot of Conduit coordination state with per-section cursors", inputSchema: contextSchema, annotations: readOnly }, async ({ projectId, limit, cursor, cursors }, extra) => {
    if (readScope) auth(extra, readScope);
    const project = projectId ? await getProject(projectId) : null;
    if (projectId && !project) return errorResult("project_not_found", { projectId });
    const sectionCursor = <T extends keyof NonNullable<typeof cursors>>(name: T) => cursors?.[name];
    const [agents, tasks, contacts, tools, resources, activity, projects] = await Promise.all([
      listAgentsPage({ limit, cursor: sectionCursor("agents") }), listTasksPage({ projectId, limit, cursor: sectionCursor("tasks") }),
      listContactsPage({ projectId, limit, cursor: sectionCursor("contacts") }), listToolsPage({ projectId, limit, cursor: sectionCursor("tools") }),
      listResourcesPage({ projectId, limit, cursor: sectionCursor("resources") }), listActivityPage({ projectId, limit, cursor: sectionCursor("activity") }),
      projectId ? Promise.resolve({ items: [] }) : listProjectsPage({ limit, cursor: sectionCursor("projects") }),
    ]);
    return json({
      conduit: getDevelopmentContext(),
      coordination: {
        service: "Conduit", generatedAt: new Date().toISOString(), project,
        agents, tasks, contacts, tools, resources, activity, projects,
      },
    });
  });
}
