import { listActivity, listAgents, listTasks, listTools } from "./store.js";
import { SERVICE_NAME, VERSION } from "./version.js";

export type ConduitConnectionStatus = "connected" | "registered";
export type ConduitConnection = {
  id: string;
  label: string;
  status: ConduitConnectionStatus;
  lastActivity?: string;
};

export type ConduitStatus = {
  service: string;
  version: string;
  status: "online";
  connections: ConduitConnection[];
  tools: Awaited<ReturnType<typeof listTools>>;
  tasks: Awaited<ReturnType<typeof listTasks>>;
  activity: Record<string, string>[];
};

const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key/i;
const ACTOR_KEYS = ["agentId", "actor", "clientId", "subject", "createdBy", "claimedBy"] as const;

function isSensitiveKey(key: string) {
  return SECRET_KEY.test(key);
}

function sanitizeActivity(event: Record<string, string>) {
  return Object.fromEntries(Object.entries(event).filter(([key]) => !isSensitiveKey(key)));
}

function activityMatchesAgent(event: Record<string, string>, agentId: string) {
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
  const connections = agents.map((agent) => {
    const matchingEvent = activity.find((event) => activityMatchesAgent(event, agent.id));
    return {
      id: agent.id,
      label: agent.name,
      status: matchingEvent ? "connected" as const : "registered" as const,
      ...(matchingEvent?.at ? { lastActivity: matchingEvent.at } : {}),
    };
  });

  return {
    service: SERVICE_NAME,
    version: VERSION,
    status: "online",
    connections,
    tools,
    tasks: tasks.slice(0, 25),
    activity: recentActivity.slice(0, 25),
  };
}
