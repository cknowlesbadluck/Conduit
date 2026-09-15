import { listActivity, listAgents, listTasks, listTools } from "./store.js";
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

const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key/i;
const SECRET_VALUE = /(https?:\/\/[^\s?]+\?[^\s]*?(?:token|key|secret|password|auth)[^\s]*)/gi;
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
  const connections = agents.map((agent) => {
    const matchingEvent = activity.find((event) => activityMatchesAgent(event, agent.id));
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
