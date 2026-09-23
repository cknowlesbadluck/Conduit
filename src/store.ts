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

/** Bounds unbounded audit-log growth: keeps the most recent ACTIVITY_RETENTION_LIMIT rows. Hygiene pass, not a per-write op — safe to run occasionally (e.g. at startup, or on demand via activity_prune). */
export async function pruneActivity() {
  if (!pool) return 0;
  const result = await pool.query(
    "DELETE FROM activity WHERE id IN (SELECT id FROM activity ORDER BY at DESC, id DESC OFFSET $1)",
    [ACTIVITY_RETENTION_LIMIT],
  );
  return result.rowCount ?? 0;
}

async function logWithClient(client: pg.PoolClient, type: string, data: Record<string, string>) {
  const event = { id: id("evt"), type, at: now(), ...data };
  await client.query("INSERT INTO activity(id,type,at,data,project_id) VALUES($1,$2,$3,$4,$5)", [event.id, type, event.at, JSON.stringify(data), data.projectId ?? null]);
}

async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

const taskSelect = `id,project_id AS "projectId",title,description,status,created_by AS "createdBy",claimed_by AS "claimedBy",created_at AS "createdAt",updated_at AS "updatedAt"`;
const normalizeTask = (row: Record<string, unknown>): Task => ({
  id: row.id as string,
  projectId: (row.projectId as string | null) ?? undefined,
  title: row.title as string,
  description: row.description as string,
  status: row.status as TaskStatus,
  createdBy: row.createdBy as string,
  claimedBy: (row.claimedBy as string | null) ?? undefined,
  createdAt: new Date(row.createdAt as string | Date).toISOString(),
  updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
});

export async function init() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO schema_migrations(version) VALUES('0.7.1') ON CONFLICT (version) DO NOTHING;
      CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS agent_bindings (subject text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS resources (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, kind text NOT NULL, endpoint text, created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, project_id text REFERENCES projects(id), title text NOT NULL, description text NOT NULL, status text NOT NULL CHECK (status IN ('open','claimed','blocked','completed')), created_by text NOT NULL REFERENCES agents(id), claimed_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS handoffs (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), from_agent text NOT NULL REFERENCES agents(id), to_agent text NOT NULL REFERENCES agents(id), note text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS contacts (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, value text NOT NULL, kind text NOT NULL, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS tools (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, endpoint text, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS activity (id text PRIMARY KEY, type text NOT NULL, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL DEFAULT '{}'::jsonb, project_id text REFERENCES projects(id));
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by text REFERENCES agents(id);
      ALTER TABLE tools ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      ALTER TABLE tools ADD COLUMN IF NOT EXISTS created_by text REFERENCES agents(id);
      ALTER TABLE activity ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      CREATE INDEX IF NOT EXISTS tasks_project_status_created_idx ON tasks(project_id,status,created_at DESC);
      CREATE INDEX IF NOT EXISTS resources_project_created_idx ON resources(project_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS contacts_project_created_idx ON contacts(project_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS tools_project_created_idx ON tools(project_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS activity_project_at_idx ON activity(project_id,at DESC);
      CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS tasks_claimed_by_created_idx ON tasks(claimed_by, created_at DESC);
      CREATE INDEX IF NOT EXISTS tasks_created_by_created_idx ON tasks(created_by, created_at DESC);
      CREATE INDEX IF NOT EXISTS activity_at_idx ON activity(at DESC);
      CREATE INDEX IF NOT EXISTS handoffs_task_idx ON handoffs(task_id, created_at DESC);
      ALTER TABLE agent_bindings DROP CONSTRAINT IF EXISTS agent_bindings_agent_id_key;
      CREATE INDEX IF NOT EXISTS agent_bindings_agent_id_idx ON agent_bindings(agent_id);
      INSERT INTO schema_migrations(version) VALUES('0.8.1-drop-agent-id-unique') ON CONFLICT (version) DO NOTHING;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      ALTER TABLE resources ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      CREATE INDEX IF NOT EXISTS projects_live_created_idx ON projects(created_at DESC, id DESC) WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS resources_live_created_idx ON resources(created_at DESC, id DESC) WHERE archived_at IS NULL;
      INSERT INTO schema_migrations(version) VALUES('0.8.2-tombstones') ON CONFLICT (version) DO NOTHING;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      ALTER TABLE tools ADD COLUMN IF NOT EXISTS archived_at timestamptz;
      CREATE INDEX IF NOT EXISTS contacts_live_created_idx ON contacts(created_at DESC, id DESC) WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS tools_live_created_idx ON tools(created_at DESC, id DESC) WHERE archived_at IS NULL;
      INSERT INTO schema_migrations(version) VALUES('0.8.3-contact-tool-tombstones') ON CONFLICT (version) DO NOTHING;
    `);
    try { await pruneActivity(); } catch { /* hygiene pass is best-effort; never block startup on it */ }
  }
  ready = true;
}

export async function registerAgent(input: { id: string; name: string; description?: string; actorSubject?: string }) {
  if (pool) {
    const agent = await withTransaction(async (client) => {
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
    return agent;
  } else {
    const existingBinding = input.actorSubject ? agentBindings.get(input.actorSubject) : undefined;
    if (existingBinding && existingBinding !== input.id) return null;
    agents.set(input.id, { id: input.id, name: input.name, description: input.description, createdAt: agents.get(input.id)?.createdAt ?? now() });
    if (input.actorSubject) {
      agentBindings.set(input.actorSubject, input.id);
      const subjects = boundAgentSubjects.get(input.id) ?? new Set<string>();
      subjects.add(input.actorSubject);
      boundAgentSubjects.set(input.id, subjects);
    }
    const agent = agents.get(input.id)!;
    await log("agent.register", { agentId: input.id });
    return agent;
  }
}

export async function getBoundAgentId(actorSubject: string) {
  if (pool) return (await pool.query("SELECT agent_id AS \"agentId\" FROM agent_bindings WHERE subject=$1", [actorSubject])).rows[0]?.agentId as string | undefined;
  return agentBindings.get(actorSubject);
}

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
