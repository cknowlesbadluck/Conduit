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

// Performance Optimization: Fast-path URL redaction by checking for "?" before running
// global RegExp SECRET_VALUE match, since SECRET_VALUE requires a query string delimiter (\?).
function sanitizeValue(value: string) {
  if (!value.includes("?")) return value;
  return value.replace(SECRET_VALUE, "[REDACTED_URL]");
}

// Performance Optimization: Single-pass Object.keys loop avoids 3 intermediate array allocations
// per activity event (previously Object.entries -> filter -> map -> Object.fromEntries).
function sanitizeActivity(event: Record<string, string>) {
  const sanitized: Record<string, string> = {};
  for (const key of Object.keys(event)) {
    if (!isSensitiveKey(key)) {
      sanitized[key] = sanitizeValue(event[key]);
    }
  }
  return sanitized;
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
  // Performance Optimization: Slice activity to 25 items BEFORE mapping sanitizeActivity
  // to avoid sanitizing items that are immediately discarded.
  const recentActivity = activity.slice(0, 25).map(sanitizeActivity);

  return {
    service: SERVICE_NAME,
    version: VERSION,
    status: "online",
    connections,
    tools: safeTools,
    tasks: safeTasks,
    activity: recentActivity,
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
  // Performance Optimization: Count connected agents in single loop without allocating filtered array.
  let connected = 0;
  for (const agent of agentList) {
    if (activeAgentIds.has(agent.id)) connected++;
  }
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
