import { z } from "zod";
import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { reclaimStaleTask, staleClaimMs, taskHealth } from "./store.js";
import { errorResult } from "./errors.js";
import { requireScope, type ConduitAuthConfig } from "./auth.js";

type ToolExtra = { http?: { authInfo?: AuthInfo } };
type ResolveAgent = (extra: ToolExtra, requested?: string) => Promise<string | null | undefined>;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const writeSafe = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const auth = (extra: ToolExtra, scope: string) => requireScope(extra.http?.authInfo, scope);

/**
 * Stale-claim recovery: a claim whose holder stopped updating can be taken over, instead of the task
 * being stuck until that agent comes back. Off unless CONDUIT_TASK_STALE_CLAIM_MINUTES is set (1..10080).
 * task_health is always available and read-only: counts by status and how long held tasks have been idle.
 */
export function registerTaskRecoveryTools(server: McpServer, authConfig: ConduitAuthConfig | undefined, resolveBoundAgent: ResolveAgent) {
  const readScope = authConfig?.readScope;
  const writeScope = authConfig?.writeScope;

  server.registerTool("task_health", { description: "Bounded task coordination health: counts by status, claimed/blocked tasks bucketed by time since last update, and how many are reclaimable under CONDUIT_TASK_STALE_CLAIM_MINUTES. Returns counts only.", inputSchema: z.object({ projectId: z.string().min(1).max(200).optional() }), annotations: readOnly }, async ({ projectId }, extra) => {
    if (readScope) auth(extra, readScope);
    return json(await taskHealth(projectId));
  });

  server.registerTool("task_reclaim", { description: "Take over a claimed or blocked task whose holder has not updated it for CONDUIT_TASK_STALE_CLAIM_MINUTES. Disabled unless that setting is configured. Atomic; records task.reclaim with the previous holder.", inputSchema: z.object({ taskId: z.string().min(1), agentId: z.string().min(1).optional() }), annotations: writeSafe }, async ({ taskId, agentId }, extra) => {
    if (writeScope) auth(extra, writeScope);
    const staleMs = staleClaimMs();
    if (staleMs === null) return errorResult("stale_reclaim_disabled", { taskId, setting: "CONDUIT_TASK_STALE_CLAIM_MINUTES" });
    const actor = await resolveBoundAgent(extra, agentId);
    if (!actor) return errorResult("agent_identity_not_bound_or_impersonation", { requestedAgentId: agentId });
    const result = await reclaimStaleTask(taskId, actor, staleMs);
    return result ? json({ ...result.task, reclaimedFrom: result.previousAgentId, idleMinutes: Math.floor(result.idleMs / 60_000) }) : errorResult("task_not_reclaimable", { taskId, staleClaimMinutes: staleMs / 60_000 });
  });
}
