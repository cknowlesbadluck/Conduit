import pg from "pg";

const { Pool } = pg;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
export type Agent = { id: string; name: string; description?: string; createdAt: string };
export type Task = { id: string; title: string; description: string; status: TaskStatus; createdBy: string; claimedBy?: string; createdAt: string; updatedAt: string };
export type ActivityEvent = Record<string, string>;

const agents = new Map<string, Agent>();
const tasks = new Map<string, Task>();
const contacts: Array<Record<string, string>> = [];
const tools: Array<Record<string, string>> = [];
const activity: ActivityEvent[] = [];
const useDatabase = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";
const pool = useDatabase
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }, max: 5 })
  : null;

let ready = false;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function isReady() { return ready; }

async function log(type: string, data: Record<string, string>) {
  const event = { id: id("evt"), type, at: now(), ...data };
  if (pool) await pool.query("INSERT INTO activity(id,type,at,data) VALUES($1,$2,$3,$4)", [event.id, type, event.at, JSON.stringify(data)]);
  else activity.unshift(event);
}

export async function init() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, title text NOT NULL, description text NOT NULL, status text NOT NULL CHECK (status IN ('open','claimed','blocked','completed')), created_by text NOT NULL REFERENCES agents(id), claimed_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS handoffs (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), from_agent text NOT NULL REFERENCES agents(id), to_agent text NOT NULL REFERENCES agents(id), note text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS contacts (id text PRIMARY KEY, name text NOT NULL, value text NOT NULL, kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS tools (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL, endpoint text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS activity (id text PRIMARY KEY, type text NOT NULL, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL DEFAULT '{}'::jsonb);
      CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS activity_at_idx ON activity(at DESC);
      CREATE INDEX IF NOT EXISTS handoffs_task_idx ON handoffs(task_id, created_at DESC);
    `);
  }
  ready = true;
}

export async function registerAgent(input: { id: string; name: string; description?: string }) {
  const agent = { ...input, createdAt: now() };
  if (pool) await pool.query("INSERT INTO agents(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description", [input.id, input.name, input.description ?? null]);
  else agents.set(input.id, agent);
  await log("agent.register", { agentId: input.id });
  return agent;
}

export async function listAgents() {
  if (pool) return (await pool.query("SELECT id,name,description,created_at AS \"createdAt\" FROM agents ORDER BY created_at DESC")).rows;
  return [...agents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function agentExists(agentId: string) {
  if (pool) return Boolean((await pool.query("SELECT 1 FROM agents WHERE id=$1", [agentId])).rowCount);
  return agents.has(agentId);
}

export async function createTask(input: { title: string; description?: string; createdBy: string }) {
  if (!(await agentExists(input.createdBy))) return null;
  const t: Task = { id: id("task"), title: input.title, description: input.description ?? "", status: "open", createdBy: input.createdBy, createdAt: now(), updatedAt: now() };
  if (pool) await pool.query("INSERT INTO tasks(id,title,description,status,created_by) VALUES($1,$2,$3,$4,$5)", [t.id, t.title, t.description, t.status, t.createdBy]);
  else tasks.set(t.id, t);
  await log("task.create", { taskId: t.id, agentId: t.createdBy });
  return t;
}

export async function listTasks(status?: TaskStatus) {
  if (pool) {
    const sql = "SELECT id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM tasks";
    return status
      ? (await pool.query(`${sql} WHERE status=$1 ORDER BY created_at DESC`, [status])).rows
      : (await pool.query(`${sql} ORDER BY created_at DESC`)).rows;
  }
  return [...tasks.values()].filter((t) => !status || t.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function claimTask(taskId: string, agentId: string) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    const r = await pool.query("UPDATE tasks SET status='claimed',claimed_by=$2,updated_at=now() WHERE id=$1 AND status='open' RETURNING id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"", [taskId, agentId]);
    if (!r.rowCount) return null;
    await log("task.claim", { taskId, agentId });
    return r.rows[0] as Task;
  }
  const t = tasks.get(taskId);
  if (!t || t.status !== "open") return null;
  t.status = "claimed"; t.claimedBy = agentId; t.updatedAt = now();
  await log("task.claim", { taskId, agentId });
  return t;
}

export async function completeTask(taskId: string, agentId: string) {
  if (pool) {
    const r = await pool.query("UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND claimed_by=$2 AND status='claimed' RETURNING id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"", [taskId, agentId]);
    if (!r.rowCount) return null;
    await log("task.complete", { taskId, agentId });
    return r.rows[0] as Task;
  }
  const t = tasks.get(taskId);
  if (!t || t.status !== "claimed" || t.claimedBy !== agentId) return null;
  t.status = "completed"; t.updatedAt = now();
  await log("task.complete", { taskId, agentId });
  return t;
}

export async function handoff(taskId: string, fromAgent: string, toAgent: string, note?: string) {
  if (fromAgent === toAgent) return null;
  if (!(await agentExists(fromAgent)) || !(await agentExists(toAgent))) return null;
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const task = (await client.query("SELECT id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM tasks WHERE id=$1 FOR UPDATE", [taskId])).rows[0] as Task | undefined;
      if (!task || task.status !== "claimed" || task.claimedBy !== fromAgent) { await client.query("ROLLBACK"); return null; }
      const updated = (await client.query("UPDATE tasks SET claimed_by=$2,updated_at=now() WHERE id=$1 RETURNING id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"", [taskId, toAgent])).rows[0] as Task;
      await client.query("INSERT INTO handoffs(id,task_id,from_agent,to_agent,note) VALUES($1,$2,$3,$4,$5)", [id("handoff"), taskId, fromAgent, toAgent, note ?? null]);
      await client.query("COMMIT");
      await log("task.handoff", { taskId, agentId: fromAgent, toAgent, note: note ?? "" });
      return { ...updated, handoffNote: note ?? "" };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  const t = tasks.get(taskId);
  if (!t || t.status !== "claimed" || t.claimedBy !== fromAgent) return null;
  t.claimedBy = toAgent; t.updatedAt = now();
  await log("task.handoff", { taskId, agentId: fromAgent, toAgent, note: note ?? "" });
  return { ...t, handoffNote: note ?? "" };
}

export async function addContact(name: string, value: string, kind: string) {
  const c = { id: id("contact"), name, value, kind, createdAt: now() };
  if (pool) await pool.query("INSERT INTO contacts(id,name,value,kind) VALUES($1,$2,$3,$4)", [c.id, name, value, kind]); else contacts.unshift(c);
  await log("contact.add", { contactId: c.id });
  return c;
}
export async function listContacts() { if (pool) return (await pool.query("SELECT id,name,value,kind,created_at AS \"createdAt\" FROM contacts ORDER BY created_at DESC")).rows; return contacts; }
export async function registerTool(name: string, description: string, endpoint?: string) {
  const t = { id: id("tool"), name, description, endpoint: endpoint ?? "", createdAt: now() };
  if (pool) await pool.query("INSERT INTO tools(id,name,description,endpoint) VALUES($1,$2,$3,$4)", [t.id, name, description, endpoint ?? null]); else tools.unshift(t);
  await log("tool.register", { toolId: t.id });
  return t;
}
export async function listTools() { if (pool) return (await pool.query("SELECT id,name,description,endpoint,created_at AS \"createdAt\" FROM tools ORDER BY created_at DESC")).rows; return tools; }
export async function listActivity(limit = 50) {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  if (pool) {
    const rows = await pool.query("SELECT id,type,at,data FROM activity ORDER BY at DESC LIMIT $1", [safeLimit]);
    return rows.rows.map((row) => ({ id: row.id, type: row.type, at: new Date(row.at).toISOString(), ...(row.data ?? {}) }));
  }
  return activity.slice(0, safeLimit);
}

export async function getCoordinationContext() {
  const [agentList, taskList, contactList, toolList, activityList] = await Promise.all([
    listAgents(),
    listTasks(),
    listContacts(),
    listTools(),
    listActivity(50),
  ]);
  return {
    service: "Conduit",
    generatedAt: now(),
    agents: agentList,
    tasks: taskList,
    contacts: contactList,
    tools: toolList,
    activity: activityList,
  };
}
