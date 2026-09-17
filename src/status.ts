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

function activityMatchesAgent(event: Record<string, string>, agentId: string) {
  if (event.type === "agent.register") return false;
  return ACTOR_KEYS.some((key) => event[key] === agentId);
}

export async function getConduitStatus(): Promise<ConduitStatus> {
  const [agents, tasks, tools, activity] = await Promise.all([
    listAgents(),
    listTasks(),
    listTools(),
    listActivity(50),
  ]);

  const recentActivity = activity.map(sanitizeActivity);

  // Performance Optimization: Build a lookup map of agentId -> latest activity event in O(M) time.
  // Since activity is ordered newest-first (DESC), the first event encountered for an agent is their latest.
  // This reduces connection matching complexity from O(N * M) to O(N + M).
  type ActivityItem = (typeof activity)[number];
  const latestActivityByAgent = new Map<string, ActivityItem>();
  for (const event of activity) {
    if (event.type === "agent.register") continue;
    for (const key of ACTOR_KEYS) {
      const actorId = event[key];
      if (actorId && typeof actorId === "string" && !latestActivityByAgent.has(actorId)) {
        latestActivityByAgent.set(actorId, event);
      }
    }
  }

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

  // Performance Optimization: Extract all active agent IDs into a Set in O(M) single pass.
  // Replaces O(N * M) nested .some() scan with O(1) Set lookup per agent (O(N + M) total).
  const activeAgentIds = new Set<string>();
  for (const event of recent) {
    if (event.type === "agent.register") continue;
    for (const key of ACTOR_KEYS) {
      const actorId = event[key];
      if (actorId && typeof actorId === "string") activeAgentIds.add(actorId);
    }
  }
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
