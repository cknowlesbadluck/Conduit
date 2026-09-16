import { countActivity, countAgents, countTasks, countTools, listActivity, listAgents, listTasks, listTools } from "./store.js";
import { SERVICE_NAME, VERSION } from "./version.js";

export type ConduitConnectionStatus = "connected" | "registered";
export type ConduitConnection = {
  id: string;
  label: string;
  status: ConduitConnectionStatus;
  lastActivity?: string;
};

type StatusTool = { id: string; projectId?: string; name: string; description: string; createdBy?: string; createdAt: string };
type StatusTask = { id: string; projectId?: string; title: string; status: Awaited<ReturnType<typeof listTasks>>[number]["status"]; claimedBy?: string; createdAt: string; updatedAt: string };

export type ConduitStatus = {
  service: string;
  version: string;
  status: "online";
  connections: ConduitConnection[];
  tools: StatusTool[];
  tasks: StatusTask[];
  activity: Record<string, string>[];
};

export type ConduitPublicStatus = {
  service: string;
  version: string;
  status: "online";
  connections: [];
  tools: [];
  tasks: [];
  activity: [];
  counts: {
    agents: number;
    connected: number;
    tools: number;
    tasks: number;
    activity: number;
  };
};

const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key/i;
const SECRET_VALUE = /(https?:\/\/[^\s?]+\?[^\s]*(?:token|key|secret|password|auth)[^\s]*)/gi;
const ACTOR_KEYS = ["agentId", "actor", "clientId", "subject", "createdBy", "claimedBy"] as const;

function isSensitiveKey(key: string) {
  return SECRET_KEY.test(key);
}

function sanitizeValue(value: string) {
  return value.replace(SECRET_VALUE, "[REDACTED_URL]");
}

function sanitizeActivity(event: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(event)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, value]) => [key, sanitizeValue(value)]),
  );
}

/**
 * Fast O(M) single pass to index the latest activity event per agent ID.
 * Avoids O(N * M) repeated linear scans over activity events for N agents.
 */
function buildLatestActivityByAgent(activity: Record<string, string>[]): Map<string, Record<string, string>> {
  const latestActivityByAgent = new Map<string, Record<string, string>>();
  for (const event of activity) {
    if (event.type === "agent.register") continue;
    for (const key of ACTOR_KEYS) {
      const agentId = event[key];
      if (agentId && !latestActivityByAgent.has(agentId)) {
        latestActivityByAgent.set(agentId, event);
      }
    }
  }
  return latestActivityByAgent;
}

/**
 * Fast O(M) single pass to collect all active agent IDs in recent activity logs.
 * Reduces connected agent count check from O(N * M) to O(N + M).
 */
function buildActiveAgentIds(activity: Record<string, string>[]): Set<string> {
  const activeAgentIds = new Set<string>();
  for (const event of activity) {
    if (event.type === "agent.register") continue;
    for (const key of ACTOR_KEYS) {
      const agentId = event[key];
      if (agentId) {
        activeAgentIds.add(agentId);
      }
    }
  }
  return activeAgentIds;
}

export async function getConduitStatus(): Promise<ConduitStatus> {
  const [agents, tasks, tools, activity] = await Promise.all([
    listAgents(),
    listTasks(),
    listTools(),
    listActivity(50),
  ]);

  const recentActivity = activity.map(sanitizeActivity);

  // Optimization: O(N + M) indexed lookup instead of O(N * M) nested activity.find per agent
  const latestActivityByAgent = buildLatestActivityByAgent(activity);
  const connections = agents.map((agent) => {
    const matchingEvent = latestActivityByAgent.get(agent.id);
    return {
      id: agent.id,
      label: agent.name,
      status: matchingEvent ? "connected" as const : "registered" as const,
      ...(matchingEvent?.at ? { lastActivity: matchingEvent.at } : {}),
    };
  });

  const safeTools: StatusTool[] = tools.map(({ endpoint: _endpoint, ...tool }) => tool);
  const safeTasks: StatusTask[] = tasks.slice(0, 25).map(({ description: _description, createdBy: _createdBy, ...task }) => task);

  return {
    service: SERVICE_NAME,
    version: VERSION,
    status: "online",
    connections,
    tools: safeTools,
    tasks: safeTasks,
    activity: recentActivity.slice(0, 25),
  };
}

/** Unauthenticated public projection. Counts only — no agent IDs, task titles, or activity payloads. */
export async function getPublicConduitStatus(): Promise<ConduitPublicStatus> {
  const [agents, tasks, tools, activity, agentList, recent] = await Promise.all([
    countAgents(),
    countTasks(),
    countTools(),
    countActivity(),
    listAgents(),
    listActivity(200),
  ]);
  // Optimization: O(N + M) set lookup instead of O(N * M) nested recent.some per agent
  const activeAgentIds = buildActiveAgentIds(recent);
  const connected = agentList.filter((agent) => activeAgentIds.has(agent.id)).length;
  return {
    service: SERVICE_NAME,
    version: VERSION,
    status: "online",
    connections: [],
    tools: [],
    tasks: [],
    activity: [],
    counts: {
      agents,
      connected,
      tools,
      tasks,
      activity,
    },
  };
}
