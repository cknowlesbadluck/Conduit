import pg from "pg";

const { Pool } = pg;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
export type Agent = { id: string; name: string; description?: string; createdAt: string };
export type Project = { id: string; name: string; description: string; createdBy: string; createdAt: string; updatedAt: string; archivedAt?: string };
export type Resource = { id: string; projectId?: string; name: string; description: string; kind: string; endpoint?: string; createdBy: string; createdAt: string; updatedAt: string; archivedAt?: string };
export type Task = { id: string; projectId?: string; title: string; description: string; status: TaskStatus; createdBy: string; claimedBy?: string; createdAt: string; updatedAt: string };
export type Contact = { id: string; projectId?: string; name: string; value: string; kind: string; createdBy?: string; createdAt: string; archivedAt?: string };
export type Tool = { id: string; projectId?: string; name: string; description: string; endpoint?: string; createdBy?: string; createdAt: string; archivedAt?: string };
export type ActivityEvent = Record<string, string>;
export type CoordinationContext = { service: string; generatedAt: string; project: Project | null; projects: Project[]; agents: Agent[]; tasks: Task[]; contacts: Contact[]; tools: Tool[]; resources: Resource[]; activity: ActivityEvent[] };

const agents = new Map<string, Agent>();
const agentBindings = new Map<string, string>();
const boundAgentSubjects = new Map<string, Set<string>>();
const projects = new Map<string, Project>();
const resources = new Map<string, Resource>();
const tasks = new Map<string, Task>();
const contacts: Contact[] = [];
const tools: Tool[] = [];
const activity: ActivityEvent[] = [];
const useDatabase = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";
const sslRejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";
const sslOption = process.env.DATABASE_SSL === "false"
  ? false
  : { rejectUnauthorized: sslRejectUnauthorized };

const pool = useDatabase
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslOption, max: 5 })
  : null;

let ready = false;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function isReady() { return ready; }

const ACTIVITY_RETENTION_LIMIT = Math.max(200, Number(process.env.CONDUIT_ACTIVITY_RETENTION) || 5000);

async function log(type: string, data: Record<string, string>) {
  const event = { id: id("evt"), type, at: now(), ...data };
  if (pool) await pool.query("INSERT INTO activity(id,type,at,data,project_id) VALUES($1,$2,$3,$4,$5)", [event.id, type, event.at, JSON.stringify(data), data.projectId ?? null]);
  else { activity.push(event); if (activity.length > ACTIVITY_RETENTION_LIMIT) activity.splice(0, activity.length - ACTIVITY_RETENTION_LIMIT); }
}

export async function pruneActivity() {
  if (!pool) return 0;
  const result = await pool.query(
    "DELETE FROM activity WHERE id IN (SELECT id FROM activity ORDER BY at DESC, id DESC OFFSET $1)",
    [ACTIVITY_RETENTION_LIMIT],
  );
  return result.rowCount ?? 0;
}

async function logWithClient(client: import("pg").PoolClient, type: string, data: Record<string, string>) {
  const event = { id: id("evt"), type, at: now(), ...data };
  await client.query("INSERT INTO activity(id,type,at,data,project_id) VALUES($1,$2,$3,$4,$5)", [event.id, type, event.at, JSON.stringify(data), data.projectId ?? null]);
}

async function withTransaction<T>(work: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error("database_not_configured");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function getBoundAgentId(actorSubject: string) {
  if (pool) return (await pool.query("SELECT agent_id AS \"agentId\" FROM agent_bindings WHERE subject=$1", [actorSubject])).rows[0]?.agentId as string | undefined;
  return agentBindings.get(actorSubject);
}

/** Subjects currently bound to a logical agent id (for collision diagnosis). */
export async function listSubjectsForAgent(agentId: string): Promise<string[]> {
  if (pool) {
    const rows = (await pool.query("SELECT subject FROM agent_bindings WHERE agent_id=$1 ORDER BY subject", [agentId])).rows as { subject: string }[];
    return rows.map((r) => r.subject);
  }
  return [...(boundAgentSubjects.get(agentId) ?? new Set<string>())].sort();
}

export async function listAgents() {
  if (pool) return (await pool.query("SELECT id,name,description,created_at AS \"createdAt\" FROM agents ORDER BY created_at DESC, id DESC")).rows;
  return [...agents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function agentExists(agentId: string) {
  if (pool) return Boolean((await pool.query("SELECT 1 FROM agents WHERE id=$1", [agentId])).rowCount);
  return agents.has(agentId);
}

export async function init() {
  if (pool) {
    await pool.query(`SELECT 1`);
  }
  ready = true;
}

// NOTE: This is a temporary stub to unblock the branch. Full store will be restored from main in the same PR.
export async function registerAgent(input: { id: string; name: string; description?: string; actorSubject?: string }) {
  if (pool) {
    return withTransaction(async (client) => {
      if (input.actorSubject) {
        const binding = (await client.query("SELECT agent_id AS \"agentId\" FROM agent_bindings WHERE subject=$1 FOR UPDATE", [input.actorSubject])).rows[0] as { agentId: string } | undefined;
        if (binding && binding.agentId !== input.id) return null;
      }
      await client.query("INSERT INTO agents(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description", [input.id, input.name, input.description ?? null]);
      if (input.actorSubject) await client.query("INSERT INTO agent_bindings(subject,agent_id) VALUES($1,$2) ON CONFLICT(subject) DO UPDATE SET agent_id=EXCLUDED.agent_id", [input.actorSubject, input.id]);
      const row = (await client.query("SELECT id,name,description,created_at AS \"createdAt\" FROM agents WHERE id=$1", [input.id])).rows[0] as Agent;
      await logWithClient(client, "agent.register", { agentId: input.id });
      return row;
    });
  }
  const existingBinding = input.actorSubject ? agentBindings.get(input.actorSubject) : undefined;
  if (existingBinding && existingBinding !== input.id) return null;
  agents.set(input.id, { id: input.id, name: input.name, description: input.description, createdAt: agents.get(input.id)?.createdAt ?? now() });
  if (input.actorSubject) {
    agentBindings.set(input.actorSubject, input.id);
    const subjects = boundAgentSubjects.get(input.id) ?? new Set<string>();
    subjects.add(input.actorSubject);
    boundAgentSubjects.set(input.id, subjects);
  }
  await log("agent.register", { agentId: input.id });
  return agents.get(input.id)!;
}
