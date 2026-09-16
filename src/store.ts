import pg from "pg";
import { publishEvent } from "./events.js";

const { Pool } = pg;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
export type Agent = { id: string; name: string; description?: string; createdAt: string };
export type Project = { id: string; name: string; description: string; createdBy: string; createdAt: string; updatedAt: string };
export type Resource = { id: string; projectId?: string; name: string; description: string; kind: string; endpoint?: string; createdBy: string; createdAt: string; updatedAt: string };
export type Task = { id: string; projectId?: string; title: string; description: string; status: TaskStatus; createdBy: string; claimedBy?: string; createdAt: string; updatedAt: string };
export type Contact = { id: string; projectId?: string; name: string; value: string; kind: string; createdBy?: string; createdAt: string };
export type Tool = { id: string; projectId?: string; name: string; description: string; endpoint?: string; createdBy?: string; createdAt: string };
export type ActivityEvent = Record<string, string>;

export type SharedState = { key: string; value: unknown; projectId?: string; updatedBy?: string; updatedAt: string };
export type Message = { id: string; fromAgent: string; toAgent?: string; projectId?: string; taskId?: string; content: string; createdAt: string };
export type ResourceLock = { id: string; resourceId: string; lockedBy: string; projectId?: string; acquiredAt: string; expiresAt: string; note?: string };

export type CoordinationContext = {
  service: string;
  generatedAt: string;
  project: Project | null;
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  contacts: Contact[];
  tools: Tool[];
  resources: Resource[];
  activity: ActivityEvent[];
  state: SharedState[];
  messages: Message[];
  locks: ResourceLock[];
};

const agents = new Map<string, Agent>();
const agentBindings = new Map<string, string>();
const boundAgentSubjects = new Map<string, string>();
const projects = new Map<string, Project>();
const resources = new Map<string, Resource>();
const tasks = new Map<string, Task>();
const contacts: Contact[] = [];
const tools: Tool[] = [];
const activity: ActivityEvent[] = [];
const sharedStateMap = new Map<string, SharedState>();
const messagesList: Message[] = [];
const resourceLocksMap = new Map<string, ResourceLock>();

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

async function log(type: string, data: Record<string, string>) {
  const event = { id: id("evt"), type, at: now(), ...data };
  if (pool) await pool.query("INSERT INTO activity(id,type,at,data,project_id) VALUES($1,$2,$3,$4,$5)", [event.id, type, event.at, JSON.stringify(data), data.projectId ?? null]);
  else activity.push(event);
  try { publishEvent(event); } catch {}
}

async function logWithClient(client: pg.PoolClient, type: string, data: Record<string, string>) {
  const event = { id: id("evt"), type, at: now(), ...data };
  await client.query("INSERT INTO activity(id,type,at,data,project_id) VALUES($1,$2,$3,$4,$5)", [event.id, type, event.at, JSON.stringify(data), data.projectId ?? null]);
  try { publishEvent(event); } catch {}
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
      CREATE TABLE IF NOT EXISTS agent_bindings (subject text PRIMARY KEY, agent_id text NOT NULL UNIQUE REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS resources (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, kind text NOT NULL, endpoint text, created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, project_id text REFERENCES projects(id), title text NOT NULL, description text NOT NULL, status text NOT NULL CHECK (status IN ('open','claimed','blocked','completed')), created_by text NOT NULL REFERENCES agents(id), claimed_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS handoffs (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), from_agent text NOT NULL REFERENCES agents(id), to_agent text NOT NULL REFERENCES agents(id), note text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS contacts (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, value text NOT NULL, kind text NOT NULL, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS tools (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, endpoint text, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS activity (id text PRIMARY KEY, type text NOT NULL, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL DEFAULT '{}'::jsonb, project_id text REFERENCES projects(id));
      CREATE TABLE IF NOT EXISTS shared_state (id text PRIMARY KEY, key text NOT NULL, project_id text REFERENCES projects(id), value jsonb NOT NULL, updated_by text REFERENCES agents(id), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS shared_state_key_project_idx ON shared_state(key, COALESCE(project_id, ''));
      CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY, from_agent text NOT NULL REFERENCES agents(id), to_agent text REFERENCES agents(id), project_id text REFERENCES projects(id), task_id text REFERENCES tasks(id), content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS messages_project_created_idx ON messages(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS messages_agents_idx ON messages(from_agent, to_agent);
      CREATE TABLE IF NOT EXISTS resource_locks (id text PRIMARY KEY, resource_id text NOT NULL, locked_by text NOT NULL REFERENCES agents(id), project_id text REFERENCES projects(id), acquired_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, note text);
      CREATE UNIQUE INDEX IF NOT EXISTS resource_locks_res_project_idx ON resource_locks(resource_id, COALESCE(project_id, ''));
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by text REFERENCES agents(id);
      ALTER TABLE tools ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      ALTER TABLE tools ADD COLUMN IF NOT EXISTS created_by text REFERENCES agents(id);
      ALTER TABLE activity ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id);
      CREATE INDEX IF NOT EXISTS tasks_project_status_created_idx ON tasks(project_id,status,created_at DESC);
      CREATE INDEX IF NOT EXISTS activity_project_at_idx ON activity(project_id,at DESC);
      CREATE INDEX IF NOT EXISTS resources_project_idx ON resources(project_id);
    `);
  }
  ready = true;
}

export async function clearInMemoryData() {
  agents.clear();
  agentBindings.clear();
  boundAgentSubjects.clear();
  projects.clear();
  resources.clear();
  tasks.clear();
  contacts.length = 0;
  tools.length = 0;
  activity.length = 0;
  sharedStateMap.clear();
  messagesList.length = 0;
  resourceLocksMap.clear();
}

export async function registerAgent(
  idOrAgent: string | { id: string; name?: string; description?: string; actorSubject?: string },
  name?: string,
  description?: string,
) {
  const idInput = typeof idOrAgent === "string" ? idOrAgent : idOrAgent.id;
  const agentName = typeof idOrAgent === "string" ? (name ?? idInput) : (idOrAgent.name ?? idOrAgent.id);
  const agentDesc = typeof idOrAgent === "string" ? description : idOrAgent.description;
  const actorSub = typeof idOrAgent === "object" ? idOrAgent.actorSubject : undefined;

  if (actorSub) {
    const bound = await getBoundAgentId(actorSub);
    if (bound && bound !== idInput) return null;
  }

  const existing = agents.get(idInput);
  if (existing) {
    if (actorSub) {
      const ok = await bindAgentIdentity(actorSub, idInput);
      if (!ok) return null;
    }
    return existing;
  }
  const agent: Agent = { id: idInput, name: agentName, description: agentDesc, createdAt: now() };
  if (pool) {
    await pool.query(
      "INSERT INTO agents(id,name,description) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING",
      [idInput, agentName, agentDesc ?? null]
    );
  } else {
    agents.set(idInput, agent);
  }
  if (actorSub) {
    const ok = await bindAgentIdentity(actorSub, idInput);
    if (!ok) {
      agents.delete(idInput);
      return null;
    }
  }
  await log("agent.register", { agentId: idInput, name: agentName });
  return agent;
}

export async function bindAgentIdentity(subject: string, agentId: string) {
  const agent = pool
    ? (await pool.query("SELECT id FROM agents WHERE id=$1", [agentId])).rows[0]
    : agents.get(agentId);
  if (!agent) return false;

  if (pool) {
    const existing = (await pool.query("SELECT agent_id FROM agent_bindings WHERE subject=$1", [subject])).rows[0];
    if (existing) return existing.agent_id === agentId;

    const boundSubject = (await pool.query("SELECT subject FROM agent_bindings WHERE agent_id=$1", [agentId])).rows[0];
    if (boundSubject && boundSubject.subject !== subject) return false;

    try {
      await pool.query("INSERT INTO agent_bindings(subject, agent_id) VALUES($1, $2)", [subject, agentId]);
      await log("agent.bind", { subject, agentId });
      return true;
    } catch {
      return false;
    }
  }

  const existingAgent = agentBindings.get(subject);
  if (existingAgent) return existingAgent === agentId;

  const existingSubject = boundAgentSubjects.get(agentId);
  if (existingSubject && existingSubject !== subject) return false;

  agentBindings.set(subject, agentId);
  boundAgentSubjects.set(agentId, subject);
  await log("agent.bind", { subject, agentId });
  return true;
}

export async function getBoundAgentId(subject: string) {
  if (pool) {
    const row = (await pool.query("SELECT agent_id FROM agent_bindings WHERE subject=$1", [subject])).rows[0];
    return row?.agent_id as string | undefined;
  }
  return agentBindings.get(subject);
}

export async function agentExists(idInput: string) {
  if (pool) {
    const row = (await pool.query("SELECT id FROM agents WHERE id=$1", [idInput])).rows[0];
    return Boolean(row);
  }
  return agents.has(idInput);
}

export async function listAgents() {
  if (pool) {
    const rows = (await pool.query("SELECT id, name, description, created_at AS \"createdAt\" FROM agents ORDER BY created_at DESC, id DESC")).rows;
    return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
  }
  return Array.from(agents.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createProject(
  nameOrInput: string | { name: string; description?: string; createdBy: string },
  description?: string,
  createdBy?: string,
) {
  const name = typeof nameOrInput === "string" ? nameOrInput : nameOrInput.name;
  const desc = typeof nameOrInput === "string" ? (description ?? "") : (nameOrInput.description ?? "");
  const creator = typeof nameOrInput === "string" ? (createdBy ?? "") : nameOrInput.createdBy;

  if (!(await agentExists(creator))) return null;
  const p: Project = { id: id("proj"), name, description: desc, createdBy: creator, createdAt: now(), updatedAt: now() };
  if (pool) {
    await pool.query(
      "INSERT INTO projects(id,name,description,created_by) VALUES($1,$2,$3,$4)",
      [p.id, name, desc, creator]
    );
  } else {
    projects.set(p.id, p);
  }
  await log("project.create", { projectId: p.id, name, createdBy: creator });
  return p;
}

export async function projectExists(projectId: string) {
  if (pool) {
    const row = (await pool.query("SELECT id FROM projects WHERE id=$1", [projectId])).rows[0];
    return Boolean(row);
  }
  return projects.has(projectId);
}

export async function listProjects() {
  if (pool) {
    const rows = (await pool.query("SELECT id, name, description, created_by AS \"createdBy\", created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM projects ORDER BY created_at DESC, id DESC")).rows;
    return rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }
  return Array.from(projects.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function registerResource(
  nameOrInput: string | { name: string; description: string; kind: string; endpoint?: string; projectId?: string; createdBy: string },
  description?: string,
  kind?: string,
  endpoint?: string,
  projectId?: string,
  createdBy?: string,
) {
  const name = typeof nameOrInput === "string" ? nameOrInput : nameOrInput.name;
  const desc = typeof nameOrInput === "string" ? (description ?? "") : nameOrInput.description;
  const k = typeof nameOrInput === "string" ? (kind ?? "") : nameOrInput.kind;
  const ep = typeof nameOrInput === "string" ? endpoint : nameOrInput.endpoint;
  const projId = typeof nameOrInput === "string" ? projectId : nameOrInput.projectId;
  const creator = typeof nameOrInput === "string" ? createdBy : nameOrInput.createdBy;

  if (!creator || !(await agentExists(creator))) return null;
  if (projId && !(await projectExists(projId))) return null;
  const r: Resource = { id: id("res"), projectId: projId, name, description: desc, kind: k, endpoint: ep, createdBy: creator, createdAt: now(), updatedAt: now() };
  if (pool) {
    await pool.query(
      "INSERT INTO resources(id,project_id,name,description,kind,endpoint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [r.id, projId ?? null, name, desc, k, ep ?? null, creator]
    );
  } else {
    resources.set(r.id, r);
  }
  await log("resource.register", { resourceId: r.id, name, createdBy: creator, ...(projId ? { projectId: projId } : {}) });
  return r;
}

export async function listResources(projectId?: string) {
  if (pool) {
    const rows = (await pool.query(
      "SELECT id, project_id AS \"projectId\", name, description, kind, endpoint, created_by AS \"createdBy\", created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM resources" +
      (projectId ? " WHERE project_id=$1" : "") + " ORDER BY created_at DESC, id DESC",
      projectId ? [projectId] : []
    )).rows;
    return rows.map((r) => ({
      ...r,
      projectId: r.projectId ?? undefined,
      endpoint: r.endpoint ?? undefined,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }
  return Array.from(resources.values())
    .filter((r) => !projectId || r.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createTask(input: { title: string; description?: string; createdBy: string; projectId?: string }) {
  if (!(await agentExists(input.createdBy))) return null;
  if (input.projectId && !(await projectExists(input.projectId))) return null;
  const t: Task = {
    id: id("task"),
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? "",
    status: "open",
    createdBy: input.createdBy,
    createdAt: now(),
    updatedAt: now(),
  };
  if (pool) {
    await pool.query(
      "INSERT INTO tasks(id,project_id,title,description,status,created_by) VALUES($1,$2,$3,$4,$5,$6)",
      [t.id, t.projectId ?? null, t.title, t.description, t.status, t.createdBy]
    );
  } else {
    tasks.set(t.id, t);
  }
  await log("task.create", { taskId: t.id, title: t.title, createdBy: t.createdBy, ...(t.projectId ? { projectId: t.projectId } : {}) });
  return t;
}

export async function listTasks(
  filterOrStatus?: TaskStatus | { status?: TaskStatus; projectId?: string; claimedBy?: string; createdBy?: string },
  projectId?: string,
  claimedBy?: string,
  createdBy?: string,
) {
  const filter = typeof filterOrStatus === "object" ? filterOrStatus : {
    status: filterOrStatus,
    projectId,
    claimedBy,
    createdBy,
  };

  if (pool) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter.status) { values.push(filter.status); clauses.push(`status=$${values.length}`); }
    if (filter.projectId) { values.push(filter.projectId); clauses.push(`project_id=$${values.length}`); }
    if (filter.claimedBy) { values.push(filter.claimedBy); clauses.push(`claimed_by=$${values.length}`); }
    if (filter.createdBy) { values.push(filter.createdBy); clauses.push(`created_by=$${values.length}`); }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = (await pool.query(`SELECT ${taskSelect} FROM tasks${where} ORDER BY created_at DESC, id DESC`, values)).rows;
    return rows.map(normalizeTask);
  }
  return Array.from(tasks.values())
    .filter((t) => (!filter.status || t.status === filter.status) &&
                   (!filter.projectId || t.projectId === filter.projectId) &&
                   (!filter.claimedBy || t.claimedBy === filter.claimedBy) &&
                   (!filter.createdBy || t.createdBy === filter.createdBy))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function claimTask(taskId: string, agentId: string) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE tasks SET status='claimed',claimed_by=$2,updated_at=now() WHERE id=$1 AND status='open' RETURNING ${taskSelect}`,
        [taskId, agentId]
      );
      if (!r.rowCount) return null;
      const task = normalizeTask(r.rows[0]);
      await logWithClient(client, "task.claim", { taskId, agentId, ...(task.projectId ? { projectId: task.projectId } : {}) });
      return task;
    });
  }
  const t = tasks.get(taskId);
  if (!t || t.status !== "open") return null;
  const previous = { ...t };
  t.status = "claimed";
  t.claimedBy = agentId;
  t.updatedAt = now();
  try {
    await log("task.claim", { taskId, agentId, ...(t.projectId ? { projectId: t.projectId } : {}) });
  } catch (error) {
    Object.assign(t, previous);
    throw error;
  }
  return t;
}

export async function completeTask(taskId: string, agentId: string) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND claimed_by=$2 AND status='claimed' RETURNING ${taskSelect}`,
        [taskId, agentId]
      );
      if (!r.rowCount) return null;
      const task = normalizeTask(r.rows[0]);
      await logWithClient(client, "task.complete", { taskId, agentId, ...(task.projectId ? { projectId: task.projectId } : {}) });
      return task;
    });
  }
  const t = tasks.get(taskId);
  if (!t || t.status !== "claimed" || t.claimedBy !== agentId) return null;
  const previous = { ...t };
  t.status = "completed";
  t.updatedAt = now();
  try {
    await log("task.complete", { taskId, agentId, ...(t.projectId ? { projectId: t.projectId } : {}) });
  } catch (error) {
    Object.assign(t, previous);
    throw error;
  }
  return t;
}

export async function handoff(taskId: string, fromAgent: string, toAgent: string, note?: string) {
  if (fromAgent === toAgent) return null;
  if (!(await agentExists(fromAgent)) || !(await agentExists(toAgent))) return null;
  if (pool) {
    return withTransaction(async (client) => {
      const task = (await client.query(`SELECT ${taskSelect} FROM tasks WHERE id=$1 FOR UPDATE`, [taskId])).rows[0] as Record<string, unknown> | undefined;
      if (!task || task.status !== "claimed" || task.claimedBy !== fromAgent) return null;
      const updated = (await client.query(`UPDATE tasks SET claimed_by=$2,updated_at=now() WHERE id=$1 RETURNING ${taskSelect}`, [taskId, toAgent])).rows[0];
      await client.query("INSERT INTO handoffs(id,task_id,from_agent,to_agent,note) VALUES($1,$2,$3,$4,$5)", [id("handoff"), taskId, fromAgent, toAgent, note ?? null]);
      const normalized = normalizeTask(updated);
      await logWithClient(client, "task.handoff", { taskId, agentId: fromAgent, toAgent, note: note ?? "", ...(normalized.projectId ? { projectId: normalized.projectId } : {}) });
      return { ...normalized, handoffNote: note ?? "" };
    });
  }
  const t = tasks.get(taskId);
  if (!t || t.status !== "claimed" || t.claimedBy !== fromAgent) return null;
  const previous = { ...t };
  t.claimedBy = toAgent;
  t.updatedAt = now();
  try {
    await log("task.handoff", { taskId, agentId: fromAgent, toAgent, note: note ?? "", ...(t.projectId ? { projectId: t.projectId } : {}) });
  } catch (error) {
    Object.assign(t, previous);
    throw error;
  }
  return { ...t, handoffNote: note ?? "" };
}

export async function addContact(
  nameOrInput: string | { name: string; value: string; kind: string; projectId?: string; createdBy?: string },
  value?: string,
  kind?: string,
  projectId?: string,
  createdBy?: string,
) {
  const name = typeof nameOrInput === "string" ? nameOrInput : nameOrInput.name;
  const val = typeof nameOrInput === "string" ? (value ?? "") : nameOrInput.value;
  const k = typeof nameOrInput === "string" ? (kind ?? "") : nameOrInput.kind;
  const projId = typeof nameOrInput === "string" ? projectId : nameOrInput.projectId;
  const creator = typeof nameOrInput === "string" ? createdBy : nameOrInput.createdBy;

  if ((projId && !(await projectExists(projId))) || (creator && !(await agentExists(creator)))) return null;
  const c: Contact = { id: id("contact"), projectId: projId, name, value: val, kind: k, createdBy: creator, createdAt: now() };
  if (pool) await pool.query("INSERT INTO contacts(id,project_id,name,value,kind,created_by) VALUES($1,$2,$3,$4,$5,$6)", [c.id, c.projectId ?? null, name, val, k, creator ?? null]);
  else contacts.push(c);
  await log("contact.add", { contactId: c.id, ...(projId ? { projectId: projId } : {}), ...(creator ? { agentId: creator } : {}) });
  return c;
}

export async function listContacts(projectId?: string) {
  if (pool) return (await pool.query("SELECT id,project_id AS \"projectId\",name,value,kind,created_by AS \"createdBy\",created_at AS \"createdAt\" FROM contacts" + (projectId ? " WHERE project_id=$1" : "") + " ORDER BY created_at DESC, id DESC", projectId ? [projectId] : [])).rows;
  return contacts.filter((c) => !projectId || c.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function registerTool(
  nameOrInput: string | { name: string; description: string; endpoint?: string; projectId?: string; createdBy?: string },
  description?: string,
  endpoint?: string,
  projectId?: string,
  createdBy?: string,
) {
  const name = typeof nameOrInput === "string" ? nameOrInput : nameOrInput.name;
  const desc = typeof nameOrInput === "string" ? (description ?? "") : nameOrInput.description;
  const ep = typeof nameOrInput === "string" ? endpoint : nameOrInput.endpoint;
  const projId = typeof nameOrInput === "string" ? projectId : nameOrInput.projectId;
  const creator = typeof nameOrInput === "string" ? createdBy : nameOrInput.createdBy;

  if ((projId && !(await projectExists(projId))) || (creator && !(await agentExists(creator)))) return null;
  const t: Tool = { id: id("tool"), projectId: projId, name, description: desc, endpoint: ep, createdBy: creator, createdAt: now() };
  if (pool) await pool.query("INSERT INTO tools(id,project_id,name,description,endpoint,created_by) VALUES($1,$2,$3,$4,$5,$6)", [t.id, t.projectId ?? null, name, desc, ep ?? null, creator ?? null]);
  else tools.push(t);
  await log("tool.register", { toolId: t.id, ...(projId ? { projectId: projId } : {}), ...(creator ? { agentId: creator } : {}) });
  return t;
}

export async function listTools(projectId?: string) {
  if (pool) return (await pool.query("SELECT id,project_id AS \"projectId\",name,description,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\" FROM tools" + (projectId ? " WHERE project_id=$1" : "") + " ORDER BY created_at DESC, id DESC", projectId ? [projectId] : [])).rows;
  return tools.filter((t) => !projectId || t.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listActivity(limit = 50, projectId?: string) {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  if (pool) {
    const rows = await pool.query("SELECT id,type,at,data,project_id AS \"projectId\" FROM activity" + (projectId ? " WHERE project_id=$2" : "") + " ORDER BY at DESC, id DESC LIMIT $1", projectId ? [safeLimit, projectId] : [safeLimit]);
    return rows.rows.map((row) => ({ id: row.id, type: row.type, at: new Date(row.at).toISOString(), ...(row.data ?? {}), ...(row.projectId ? { projectId: row.projectId } : {}) }));
  }
  const matches: ActivityEvent[] = [];
  for (let i = activity.length - 1; i >= 0 && matches.length < safeLimit; i--) {
    const event = activity[i];
    if (!projectId || event.projectId === projectId) matches.push(event);
  }
  return matches;
}

export async function setState(
  keyOrInput: string | { key: string; value: unknown; projectId?: string; updatedBy?: string },
  value?: unknown,
  projectId?: string,
  updatedBy?: string,
): Promise<SharedState | null> {
  const key = typeof keyOrInput === "string" ? keyOrInput : keyOrInput.key;
  const val = typeof keyOrInput === "string" ? value : keyOrInput.value;
  const projId = typeof keyOrInput === "string" ? projectId : keyOrInput.projectId;
  const updater = typeof keyOrInput === "string" ? updatedBy : keyOrInput.updatedBy;

  if ((projId && !(await projectExists(projId))) || (updater && !(await agentExists(updater)))) return null;
  const updatedAt = now();
  const stateKey = `${projId ?? "global"}:${key}`;
  const item: SharedState = { key, value: val, projectId: projId, updatedBy: updater, updatedAt };

  if (pool) {
    const jsonVal = JSON.stringify(val);
    await pool.query(
      `INSERT INTO shared_state(id, key, project_id, value, updated_by, updated_at)
       VALUES($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key, COALESCE(project_id, ''))
       DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [id("state"), key, projId ?? null, jsonVal, updater ?? null, updatedAt]
    );
  } else {
    sharedStateMap.set(stateKey, item);
  }

  await log("state.set", { key, ...(projId ? { projectId: projId } : {}), ...(updater ? { agentId: updater } : {}) });
  return item;
}

export async function getState(key: string, projectId?: string): Promise<SharedState | null> {
  if (pool) {
    const row = (await pool.query(
      `SELECT key, project_id AS "projectId", value, updated_by AS "updatedBy", updated_at AS "updatedAt"
       FROM shared_state WHERE key = $1 AND COALESCE(project_id, '') = $2`,
      [key, projectId ?? ""]
    )).rows[0];
    if (!row) return null;
    return {
      key: row.key,
      projectId: row.projectId ?? undefined,
      value: row.value,
      updatedBy: row.updatedBy ?? undefined,
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
  const stateKey = `${projectId ?? "global"}:${key}`;
  return sharedStateMap.get(stateKey) ?? null;
}

export async function listState(projectId?: string): Promise<SharedState[]> {
  if (pool) {
    const rows = (await pool.query(
      `SELECT key, project_id AS "projectId", value, updated_by AS "updatedBy", updated_at AS "updatedAt"
       FROM shared_state ${projectId ? "WHERE project_id = $1" : "WHERE project_id IS NULL"} ORDER BY key ASC`,
      projectId ? [projectId] : []
    )).rows;
    return rows.map((row) => ({
      key: row.key,
      projectId: row.projectId ?? undefined,
      value: row.value,
      updatedBy: row.updatedBy ?? undefined,
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));
  }
  const result: SharedState[] = [];
  for (const item of sharedStateMap.values()) {
    if ((projectId && item.projectId === projectId) || (!projectId && !item.projectId)) {
      result.push(item);
    }
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

export async function sendMessage(
  fromOrInput: string | { fromAgent: string; content: string; toAgent?: string; projectId?: string; taskId?: string },
  content?: string,
  options?: { toAgent?: string; projectId?: string; taskId?: string },
): Promise<Message | null> {
  const fromAgent = typeof fromOrInput === "string" ? fromOrInput : fromOrInput.fromAgent;
  const msgContent = typeof fromOrInput === "string" ? (content ?? "") : fromOrInput.content;
  const opts = typeof fromOrInput === "string" ? options : fromOrInput;

  if (!(await agentExists(fromAgent))) return null;
  if (opts?.toAgent && !(await agentExists(opts.toAgent))) return null;
  if (opts?.projectId && !(await projectExists(opts.projectId))) return null;
  if (opts?.taskId && !(await getTask(opts.taskId))) return null;

  const msg: Message = {
    id: id("msg"),
    fromAgent,
    toAgent: opts?.toAgent,
    projectId: opts?.projectId,
    taskId: opts?.taskId,
    content: msgContent,
    createdAt: now(),
  };

  if (pool) {
    await pool.query(
      `INSERT INTO messages(id, from_agent, to_agent, project_id, task_id, content, created_at)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [msg.id, msg.fromAgent, msg.toAgent ?? null, msg.projectId ?? null, msg.taskId ?? null, msg.content, msg.createdAt]
    );
  } else {
    messagesList.push(msg);
  }

  await log("message.send", {
    messageId: msg.id,
    fromAgent: msg.fromAgent,
    ...(msg.toAgent ? { toAgent: msg.toAgent } : {}),
    ...(msg.projectId ? { projectId: msg.projectId } : {}),
    ...(msg.taskId ? { taskId: msg.taskId } : {}),
  });

  return msg;
}

export async function listMessages(options?: { fromAgent?: string; toAgent?: string; projectId?: string; taskId?: string }): Promise<Message[]> {
  if (pool) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (options?.projectId) { values.push(options.projectId); clauses.push(`project_id = $${values.length}`); }
    if (options?.taskId) { values.push(options.taskId); clauses.push(`task_id = $${values.length}`); }
    if (options?.fromAgent) { values.push(options.fromAgent); clauses.push(`from_agent = $${values.length}`); }
    if (options?.toAgent) { values.push(options.toAgent); clauses.push(`to_agent = $${values.length}`); }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = (await pool.query(
      `SELECT id, from_agent AS "fromAgent", to_agent AS "toAgent", project_id AS "projectId", task_id AS "taskId", content, created_at AS "createdAt"
       FROM messages ${where} ORDER BY created_at DESC, id DESC`,
      values
    )).rows;

    return rows.map((row) => ({
      id: row.id,
      fromAgent: row.fromAgent,
      toAgent: row.toAgent ?? undefined,
      projectId: row.projectId ?? undefined,
      taskId: row.taskId ?? undefined,
      content: row.content,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  return messagesList
    .filter((m) => (!options?.projectId || m.projectId === options.projectId) &&
                   (!options?.taskId || m.taskId === options.taskId) &&
                   (!options?.fromAgent || m.fromAgent === options.fromAgent) &&
                   (!options?.toAgent || m.toAgent === options.toAgent))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function acquireLock(
  resourceOrInput: string | { resourceId: string; lockedBy: string; ttlSeconds?: number; projectId?: string; note?: string },
  lockedBy?: string,
  options?: { ttlSeconds?: number; projectId?: string; note?: string },
): Promise<ResourceLock | null> {
  const resourceId = typeof resourceOrInput === "string" ? resourceOrInput : resourceOrInput.resourceId;
  const locker = typeof resourceOrInput === "string" ? (lockedBy ?? "") : resourceOrInput.lockedBy;
  const opts = typeof resourceOrInput === "string" ? options : resourceOrInput;

  if (!(await agentExists(locker))) return null;
  if (opts?.projectId && !(await projectExists(opts.projectId))) return null;

  const ttl = Math.min(Math.max(opts?.ttlSeconds ?? 300, 5), 3600);
  const acquiredAt = now();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const lockKey = `${opts?.projectId ?? "global"}:${resourceId}`;

  if (pool) {
    return withTransaction(async (client) => {
      const existing = (await client.query(
        `SELECT id, locked_by AS "lockedBy", expires_at AS "expiresAt"
         FROM resource_locks WHERE resource_id = $1 AND COALESCE(project_id, '') = $2 FOR UPDATE`,
        [resourceId, opts?.projectId ?? ""]
      )).rows[0];

      if (existing) {
        const isExpired = new Date(existing.expiresAt).getTime() <= Date.now();
        if (!isExpired && existing.lockedBy !== locker) {
          return null;
        }
      }

      const lockId = existing?.id ?? id("lock");
      const updated = (await client.query(
        `INSERT INTO resource_locks(id, resource_id, locked_by, project_id, acquired_at, expires_at, note)
         VALUES($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (resource_id, COALESCE(project_id, ''))
         DO UPDATE SET locked_by = EXCLUDED.locked_by, acquired_at = EXCLUDED.acquired_at, expires_at = EXCLUDED.expires_at, note = EXCLUDED.note
         RETURNING id, resource_id AS "resourceId", locked_by AS "lockedBy", project_id AS "projectId", acquired_at AS "acquiredAt", expires_at AS "expiresAt", note`,
        [lockId, resourceId, locker, opts?.projectId ?? null, acquiredAt, expiresAt, opts?.note ?? null]
      )).rows[0];

      const lockRecord: ResourceLock = {
        id: updated.id,
        resourceId: updated.resourceId,
        lockedBy: updated.lockedBy,
        projectId: updated.projectId ?? undefined,
        acquiredAt: new Date(updated.acquiredAt).toISOString(),
        expiresAt: new Date(updated.expiresAt).toISOString(),
        note: updated.note ?? undefined,
      };

      await logWithClient(client, "lock.acquire", {
        resourceId,
        lockedBy: locker,
        expiresAt,
        ...(opts?.projectId ? { projectId: opts.projectId } : {}),
      });

      return lockRecord;
    });
  }

  const existing = resourceLocksMap.get(lockKey);
  if (existing) {
    const isExpired = new Date(existing.expiresAt).getTime() <= Date.now();
    if (!isExpired && existing.lockedBy !== locker) {
      return null;
    }
  }

  const lockRecord: ResourceLock = {
    id: existing?.id ?? id("lock"),
    resourceId,
    lockedBy: locker,
    projectId: opts?.projectId,
    acquiredAt,
    expiresAt,
    note: opts?.note,
  };

  resourceLocksMap.set(lockKey, lockRecord);
  await log("lock.acquire", {
    resourceId,
    lockedBy: locker,
    expiresAt,
    ...(opts?.projectId ? { projectId: opts.projectId } : {}),
  });

  return lockRecord;
}

export async function releaseLock(resourceId: string, lockedBy: string, projectId?: string): Promise<boolean> {
  const lockKey = `${projectId ?? "global"}:${resourceId}`;

  if (pool) {
    return withTransaction(async (client) => {
      const existing = (await client.query(
        `SELECT id, locked_by AS "lockedBy"
         FROM resource_locks WHERE resource_id = $1 AND COALESCE(project_id, '') = $2 FOR UPDATE`,
        [resourceId, projectId ?? ""]
      )).rows[0];

      if (!existing || existing.lockedBy !== lockedBy) {
        return false;
      }

      await client.query(`DELETE FROM resource_locks WHERE id = $1`, [existing.id]);
      await logWithClient(client, "lock.release", {
        resourceId,
        lockedBy,
        ...(projectId ? { projectId } : {}),
      });
      return true;
    });
  }

  const existing = resourceLocksMap.get(lockKey);
  if (!existing || existing.lockedBy !== lockedBy) {
    return false;
  }

  resourceLocksMap.delete(lockKey);
  await log("lock.release", {
    resourceId,
    lockedBy,
    ...(projectId ? { projectId } : {}),
  });
  return true;
}

export async function listLocks(projectId?: string): Promise<ResourceLock[]> {
  const currentTime = new Date().toISOString();
  if (pool) {
    const rows = (await pool.query(
      `SELECT id, resource_id AS "resourceId", locked_by AS "lockedBy", project_id AS "projectId", acquired_at AS "acquiredAt", expires_at AS "expiresAt", note
       FROM resource_locks WHERE expires_at > $1 ${projectId ? "AND project_id = $2" : "AND project_id IS NULL"} ORDER BY acquired_at DESC`,
      projectId ? [currentTime, projectId] : [currentTime]
    )).rows;

    return rows.map((row) => ({
      id: row.id,
      resourceId: row.resourceId,
      lockedBy: row.lockedBy,
      projectId: row.projectId ?? undefined,
      acquiredAt: new Date(row.acquiredAt).toISOString(),
      expiresAt: new Date(row.expiresAt).toISOString(),
      note: row.note ?? undefined,
    }));
  }

  const result: ResourceLock[] = [];
  for (const lock of resourceLocksMap.values()) {
    const isExpired = new Date(lock.expiresAt).getTime() <= Date.now();
    if (!isExpired && ((projectId && lock.projectId === projectId) || (!projectId && !lock.projectId))) {
      result.push(lock);
    }
  }
  return result.sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
}

export async function getCoordinationContext(projectId?: string): Promise<CoordinationContext | null> {
  let project: Project | null = null;
  if (projectId) {
    project = pool ? (await pool.query("SELECT id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM projects WHERE id=$1", [projectId])).rows[0] as Project | undefined ?? null : projects.get(projectId) ?? null;
    if (!project) return null;
  }
  const [agentList, taskList, contactList, toolList, resourceList, activityList, projectList, stateList, messageList, lockList] = await Promise.all([
    listAgents(),
    listTasks({ projectId }),
    listContacts(projectId),
    listTools(projectId),
    listResources(projectId),
    listActivity(50, projectId),
    projectId ? Promise.resolve([]) : listProjects(),
    listState(projectId),
    listMessages({ projectId }),
    listLocks(projectId),
  ]);
  return {
    service: "Conduit",
    generatedAt: now(),
    project,
    projects: projectList,
    agents: agentList,
    tasks: taskList,
    contacts: contactList,
    tools: toolList,
    resources: resourceList,
    activity: activityList,
    state: stateList,
    messages: messageList,
    locks: lockList,
  };
}

export async function getProject(projectId: string) {
  if (pool) { const row = (await pool.query("SELECT id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM projects WHERE id=$1", [projectId])).rows[0]; return (row as Project) || null; }
  return projects.get(projectId) || null;
}

export async function getTask(taskId: string) {
  if (pool) { const row = (await pool.query(`SELECT ${taskSelect} FROM tasks WHERE id=$1`, [taskId])).rows[0]; return row ? normalizeTask(row) : null; }
  return tasks.get(taskId) || null;
}

export async function blockTask(taskId: string, agentId: string, reason?: string) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async (client) => {
      const r = await client.query(`UPDATE tasks SET status='blocked',updated_at=now() WHERE id=$1 AND claimed_by=$2 AND status='claimed' RETURNING ${taskSelect}`, [taskId, agentId]);
      if (!r.rowCount) return null;
      const task = normalizeTask(r.rows[0]);
      await logWithClient(client, "task.block", { taskId, agentId, ...(reason ? { reason } : {}), ...(task.projectId ? { projectId: task.projectId } : {}) });
      return task;
    });
  }
  const t = tasks.get(taskId);
  if (!t || t.status !== "claimed" || t.claimedBy !== agentId) return null;
  const previous = { ...t };
  t.status = "blocked";
  t.updatedAt = now();
  try { await log("task.block", { taskId, agentId, ...(reason ? { reason } : {}), ...(t.projectId ? { projectId: t.projectId } : {}) }); }
  catch (error) { Object.assign(t, previous); throw error; }
  return t;
}

export async function releaseTask(taskId: string, agentId: string) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async (client) => {
      const r = await client.query(`UPDATE tasks SET status='open',claimed_by=NULL,updated_at=now() WHERE id=$1 AND claimed_by=$2 AND status IN ('claimed','blocked') RETURNING ${taskSelect}`, [taskId, agentId]);
      if (!r.rowCount) return null;
      const task = normalizeTask(r.rows[0]);
      await logWithClient(client, "task.release", { taskId, agentId, ...(task.projectId ? { projectId: task.projectId } : {}) });
      return task;
    });
  }
  const t = tasks.get(taskId);
  if (!t || (t.status !== "claimed" && t.status !== "blocked") || t.claimedBy !== agentId) return null;
  const previous = { ...t };
  t.status = "open";
  delete t.claimedBy;
  t.updatedAt = now();
  try { await log("task.release", { taskId, agentId, ...(t.projectId ? { projectId: t.projectId } : {}) }); }
  catch (error) { Object.assign(t, previous); throw error; }
  return t;
}

export async function countAgents() {
  if (pool) return Number((await pool.query("SELECT COUNT(*)::int AS n FROM agents")).rows[0].n);
  return agents.size;
}

export async function countTasks() {
  if (pool) return Number((await pool.query("SELECT COUNT(*)::int AS n FROM tasks")).rows[0].n);
  return tasks.size;
}

export async function countTools() {
  if (pool) return Number((await pool.query("SELECT COUNT(*)::int AS n FROM tools")).rows[0].n);
  return tools.length;
}

export async function countActivity() {
  if (pool) return Number((await pool.query("SELECT COUNT(*)::int AS n FROM activity")).rows[0].n);
  return activity.length;
}

export async function countState() {
  if (pool) return Number((await pool.query("SELECT COUNT(*)::int AS n FROM shared_state")).rows[0].n);
  return sharedStateMap.size;
}

export async function countMessages() {
  if (pool) return Number((await pool.query("SELECT COUNT(*)::int AS n FROM messages")).rows[0].n);
  return messagesList.length;
}

export async function countLocks() {
  if (pool) return Number((await pool.query("SELECT COUNT(*)::int AS n FROM resource_locks WHERE expires_at > now()")).rows[0].n);
  let count = 0;
  for (const lock of resourceLocksMap.values()) {
    if (new Date(lock.expiresAt).getTime() > Date.now()) count++;
  }
  return count;
}
