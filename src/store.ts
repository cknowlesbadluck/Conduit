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

export async function listAgents() {
  if (pool) return (await pool.query("SELECT id,name,description,created_at AS \"createdAt\" FROM agents ORDER BY created_at DESC, id DESC")).rows;
  return [...agents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function agentExists(agentId: string) { if (pool) return Boolean((await pool.query("SELECT 1 FROM agents WHERE id=$1", [agentId])).rowCount); return agents.has(agentId); }
async function projectExists(projectId: string) { if (pool) return Boolean((await pool.query("SELECT 1 FROM projects WHERE id=$1 AND archived_at IS NULL", [projectId])).rowCount); const project = projects.get(projectId); return Boolean(project && !project.archivedAt); }

export async function createProject(input: { name: string; description?: string; createdBy: string }) {
  if (!(await agentExists(input.createdBy))) return null;
  const p: Project = { id:id("project"), name:input.name, description:input.description??"", createdBy:input.createdBy, createdAt:now(), updatedAt:now() };
  if(pool) await pool.query("INSERT INTO projects(id,name,description,created_by) VALUES($1,$2,$3,$4)",[p.id,p.name,p.description,p.createdBy]); else projects.set(p.id,p);
  await log("project.create",{projectId:p.id,agentId:p.createdBy}); return p;
}
export async function listProjects(){if(pool)return(await pool.query("SELECT id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\",archived_at AS \"archivedAt\" FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC, id DESC")).rows.map(normalizeProject);return[...projects.values()].filter(p=>!p.archivedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

export async function registerResource(input:{projectId?:string;name:string;description:string;kind:string;endpoint?:string;createdBy:string}){
  if(!(await agentExists(input.createdBy))||(input.projectId&&!(await projectExists(input.projectId))))return null;
  const r:Resource={id:id("resource"),projectId:input.projectId,name:input.name,description:input.description,kind:input.kind,endpoint:input.endpoint,createdBy:input.createdBy,createdAt:now(),updatedAt:now()};
  if(pool)await pool.query("INSERT INTO resources(id,project_id,name,description,kind,endpoint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[r.id,r.projectId??null,r.name,r.description,r.kind,r.endpoint??null,r.createdBy]);else resources.set(r.id,r);
  await log("resource.register",{resourceId:r.id,agentId:r.createdBy,...(r.projectId?{projectId:r.projectId}:{})});return r;
}
export async function listResources(projectId?:string){if(pool){const where=projectId?" WHERE project_id=$1 AND archived_at IS NULL":" WHERE archived_at IS NULL";return(await pool.query("SELECT id,project_id AS \"projectId\",name,description,kind,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\",archived_at AS \"archivedAt\" FROM resources"+where+" ORDER BY created_at DESC, id DESC",projectId?[projectId]:[])).rows.map(normalizeResource);}return[...resources.values()].filter(r=>!r.archivedAt&&(!projectId||r.projectId===projectId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

export async function createTask(input:{title:string;description?:string;createdBy:string;projectId?:string}){if(!(await agentExists(input.createdBy))||(input.projectId&&!(await projectExists(input.projectId))))return null;const t:Task={id:id("task"),projectId:input.projectId,title:input.title,description:input.description??"",status:"open",createdBy:input.createdBy,createdAt:now(),updatedAt:now()};if(pool)await pool.query("INSERT INTO tasks(id,project_id,title,description,status,created_by) VALUES($1,$2,$3,$4,$5,$6)",[t.id,t.projectId??null,t.title,t.description,t.status,t.createdBy]);else tasks.set(t.id,t);await log("task.create",{taskId:t.id,agentId:t.createdBy,...(t.projectId?{projectId:t.projectId}:{})});return t;}

export async function listTasks(options?: { status?: TaskStatus; projectId?: string; claimedBy?: string; createdBy?: string } | TaskStatus, legacyProjectId?: string) {
  const opts = typeof options === "string" || options === undefined ? { status: options, projectId: legacyProjectId } : options;
  const { status, projectId, claimedBy, createdBy } = opts;
  if (pool) {
    const sql = `SELECT ${taskSelect} FROM tasks WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR project_id=$2) AND ($3::text IS NULL OR claimed_by=$3) AND ($4::text IS NULL OR created_by=$4) ORDER BY created_at DESC, id DESC`;
    const params = [status ?? null, projectId ?? null, claimedBy ?? null, createdBy ?? null];
    const rows = (await pool.query(sql, params)).rows;
    return rows.map(normalizeTask);
  }
  return [...tasks.values()].filter(t => (!status || t.status === status) && (!projectId || t.projectId === projectId) && (!claimedBy || t.claimedBy === claimedBy) && (!createdBy || t.createdBy === createdBy)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function claimTask(taskId:string,agentId:string){
  if(!(await agentExists(agentId)))return null;
  if(pool){
    return withTransaction(async client => {
      const r=await client.query(`UPDATE tasks SET status='claimed',claimed_by=$2,updated_at=now() WHERE id=$1 AND status='open' RETURNING ${taskSelect}`,[taskId,agentId]);
      if(!r.rowCount)return null;
      const task=normalizeTask(r.rows[0]);
      await logWithClient(client,"task.claim",{taskId,agentId,...(task.projectId?{projectId:task.projectId}:{})});
      return task;
    });
  }
  const t=tasks.get(taskId);if(!t||t.status!=="open")return null;
  const previous={...t};
  t.status="claimed";t.claimedBy=agentId;t.updatedAt=now();
  try { await log("task.claim",{taskId,agentId,...(t.projectId?{projectId:t.projectId}:{})}); }
  catch (error) { Object.assign(t, previous); throw error; }
  return t;
}

export async function completeTask(taskId:string,agentId:string){
  if(!(await agentExists(agentId)))return null;
  if(pool){
    return withTransaction(async client => {
      const r=await client.query(`UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND claimed_by=$2 AND status='claimed' RETURNING ${taskSelect}`,[taskId,agentId]);
      if(!r.rowCount)return null;
      const task=normalizeTask(r.rows[0]);
      await logWithClient(client,"task.complete",{taskId,agentId,...(task.projectId?{projectId:task.projectId}:{})});
      return task;
    });
  }
  const t=tasks.get(taskId);if(!t||t.status!=="claimed"||t.claimedBy!==agentId)return null;
  const previous={...t};
  t.status="completed";t.updatedAt=now();
  try { await log("task.complete",{taskId,agentId,...(t.projectId?{projectId:t.projectId}:{})}); }
  catch (error) { Object.assign(t, previous); throw error; }
  return t;
}

export async function handoff(taskId:string,fromAgent:string,toAgent:string,note?:string){
  if(fromAgent===toAgent)return null;if(!(await agentExists(fromAgent))||!(await agentExists(toAgent)))return null;
  if(pool){
    return withTransaction(async client=>{
      const task=(await client.query(`SELECT ${taskSelect} FROM tasks WHERE id=$1 FOR UPDATE`,[taskId])).rows[0] as Record<string,unknown>|undefined;
      if(!task||task.status!=="claimed"||task.claimedBy!==fromAgent)return null;
      const updated=(await client.query(`UPDATE tasks SET claimed_by=$2,updated_at=now() WHERE id=$1 RETURNING ${taskSelect}`,[taskId,toAgent])).rows[0];
      await client.query("INSERT INTO handoffs(id,task_id,from_agent,to_agent,note) VALUES($1,$2,$3,$4,$5)",[id("handoff"),taskId,fromAgent,toAgent,note??null]);
      const normalized=normalizeTask(updated);
      await logWithClient(client,"task.handoff",{taskId,agentId:fromAgent,toAgent,note:note??"",...(normalized.projectId?{projectId:normalized.projectId}:{})});
      return {...normalized,handoffNote:note??""};
    });
  }
  const t=tasks.get(taskId);if(!t||t.status!=="claimed"||t.claimedBy!==fromAgent)return null;
  const previous={...t};
  t.claimedBy=toAgent;t.updatedAt=now();
  try { await log("task.handoff",{taskId,agentId:fromAgent,toAgent,note:note??"",...(t.projectId?{projectId:t.projectId}:{})}); }
  catch (error) { Object.assign(t, previous); throw error; }
  return{...t,handoffNote:note??""};
}

export async function addContact(name:string,value:string,kind:string,projectId?:string,createdBy?:string){if((projectId&&!(await projectExists(projectId)))||(createdBy&&!(await agentExists(createdBy))))return null;const c:Contact={id:id("contact"),projectId,name,value,kind,createdBy,createdAt:now()};if(pool)await pool.query("INSERT INTO contacts(id,project_id,name,value,kind,created_by) VALUES($1,$2,$3,$4,$5,$6)",[c.id,c.projectId??null,name,value,kind,createdBy??null]);else contacts.push(c);await log("contact.add",{contactId:c.id,...(projectId?{projectId}:{}),...(createdBy?{agentId:createdBy}:{})});return c;}
export async function listContacts(projectId?:string){if(pool)return(await pool.query("SELECT id,project_id AS \"projectId\",name,value,kind,created_by AS \"createdBy\",created_at AS \"createdAt\",archived_at AS \"archivedAt\" FROM contacts"+(projectId?" WHERE project_id=$1 AND archived_at IS NULL":" WHERE archived_at IS NULL")+" ORDER BY created_at DESC, id DESC",projectId?[projectId]:[])).rows.map(normalizeContact);return contacts.filter(c=>!c.archivedAt&&(!projectId||c.projectId===projectId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
export async function registerTool(name:string,description:string,endpoint?:string,projectId?:string,createdBy?:string){if((projectId&&!(await projectExists(projectId)))||(createdBy&&!(await agentExists(createdBy))))return null;const t:Tool={id:id("tool"),projectId,name,description,endpoint,createdBy,createdAt:now()};if(pool)await pool.query("INSERT INTO tools(id,project_id,name,description,endpoint,created_by) VALUES($1,$2,$3,$4,$5,$6)",[t.id,t.projectId??null,name,description,endpoint??null,createdBy??null]);else tools.push(t);await log("tool.register",{toolId:t.id,...(projectId?{projectId}:{}),...(createdBy?{agentId:createdBy}:{})});return t;}
export async function listTools(projectId?:string){if(pool)return(await pool.query("SELECT id,project_id AS \"projectId\",name,description,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\",archived_at AS \"archivedAt\" FROM tools"+(projectId?" WHERE project_id=$1 AND archived_at IS NULL":" WHERE archived_at IS NULL")+" ORDER BY created_at DESC, id DESC",projectId?[projectId]:[])).rows.map(normalizeTool);return tools.filter(t=>!t.archivedAt&&(!projectId||t.projectId===projectId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

function normalizeContact(row: Record<string, unknown>): Contact {
  return {
    id: row.id as string,
    projectId: (row.projectId as string | null) ?? undefined,
    name: row.name as string,
    value: row.value as string,
    kind: row.kind as string,
    createdBy: (row.createdBy as string | null) ?? undefined,
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
    archivedAt: normalizeTimestamp(row.archivedAt),
  };
}

function normalizeTool(row: Record<string, unknown>): Tool {
  return {
    id: row.id as string,
    projectId: (row.projectId as string | null) ?? undefined,
    name: row.name as string,
    description: row.description as string,
    endpoint: (row.endpoint as string | null) ?? undefined,
    createdBy: (row.createdBy as string | null) ?? undefined,
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
    archivedAt: normalizeTimestamp(row.archivedAt),
  };
}

/** Ownership-or-unowned tombstone, mirroring archiveResource: creator, parent-project creator, or asAdmin may archive. A legacy row with no recorded creator has no owner to protect, so any registered agent may archive it. */
export async function archiveContact(contactId: string, agentId: string, options?: ArchiveOptions) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async client => {
      const existing = (await client.query("SELECT id,project_id AS \"projectId\",name,value,kind,created_by AS \"createdBy\",created_at AS \"createdAt\",archived_at AS \"archivedAt\" FROM contacts WHERE id=$1 FOR UPDATE", [contactId])).rows[0] as Record<string, unknown> | undefined;
      if (!existing) return null;
      const createdBy = (existing.createdBy as string | null) ?? undefined;
      const projectId = (existing.projectId as string | null) ?? undefined;
      let projectCreator: string | undefined;
      if (projectId) {
        const projectRow = (await client.query("SELECT created_by AS \"createdBy\" FROM projects WHERE id=$1", [projectId])).rows[0] as { createdBy?: string } | undefined;
        projectCreator = projectRow?.createdBy;
      }
      if (createdBy && createdBy !== agentId && projectCreator !== agentId && !options?.asAdmin) return null;
      if (existing.archivedAt) return normalizeContact(existing);
      const row = (await client.query("UPDATE contacts SET archived_at=now() WHERE id=$1 RETURNING id,project_id AS \"projectId\",name,value,kind,created_by AS \"createdBy\",created_at AS \"createdAt\",archived_at AS \"archivedAt\"", [contactId])).rows[0];
      const contact = normalizeContact(row);
      await logWithClient(client, "contact.archive", { contactId, agentId, ...(contact.projectId ? { projectId: contact.projectId } : {}) });
      return contact;
    });
  }
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return null;
  const parent = contact.projectId ? projects.get(contact.projectId) : undefined;
  if (contact.createdBy && contact.createdBy !== agentId && parent?.createdBy !== agentId && !options?.asAdmin) return null;
  if (contact.archivedAt) return contact;
  const previous = { ...contact };
  contact.archivedAt = now();
  try { await log("contact.archive", { contactId, agentId, ...(contact.projectId ? { projectId: contact.projectId } : {}) }); }
  catch (error) { Object.assign(contact, previous); throw error; }
  return contact;
}

export async function archiveTool(toolId: string, agentId: string, options?: ArchiveOptions) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async client => {
      const existing = (await client.query("SELECT id,project_id AS \"projectId\",name,description,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\",archived_at AS \"archivedAt\" FROM tools WHERE id=$1 FOR UPDATE", [toolId])).rows[0] as Record<string, unknown> | undefined;
      if (!existing) return null;
      const createdBy = (existing.createdBy as string | null) ?? undefined;
      const projectId = (existing.projectId as string | null) ?? undefined;
      let projectCreator: string | undefined;
      if (projectId) {
        const projectRow = (await client.query("SELECT created_by AS \"createdBy\" FROM projects WHERE id=$1", [projectId])).rows[0] as { createdBy?: string } | undefined;
        projectCreator = projectRow?.createdBy;
      }
      if (createdBy && createdBy !== agentId && projectCreator !== agentId && !options?.asAdmin) return null;
      if (existing.archivedAt) return normalizeTool(existing);
      const row = (await client.query("UPDATE tools SET archived_at=now() WHERE id=$1 RETURNING id,project_id AS \"projectId\",name,description,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\",archived_at AS \"archivedAt\"", [toolId])).rows[0];
      const tool = normalizeTool(row);
      await logWithClient(client, "tool.archive", { toolId, agentId, ...(tool.projectId ? { projectId: tool.projectId } : {}) });
      return tool;
    });
  }
  const tool = tools.find(t => t.id === toolId);
  if (!tool) return null;
  const parent = tool.projectId ? projects.get(tool.projectId) : undefined;
  if (tool.createdBy && tool.createdBy !== agentId && parent?.createdBy !== agentId && !options?.asAdmin) return null;
  if (tool.archivedAt) return tool;
  const previous = { ...tool };
  tool.archivedAt = now();
  try { await log("tool.archive", { toolId, agentId, ...(tool.projectId ? { projectId: tool.projectId } : {}) }); }
  catch (error) { Object.assign(tool, previous); throw error; }
  return tool;
}
export async function listActivity(limit=50,projectId?:string){const safeLimit=Math.max(1,Math.min(limit,200));if(pool){const rows=await pool.query("SELECT id,type,at,data,project_id AS \"projectId\" FROM activity"+(projectId?" WHERE project_id=$2":"")+" ORDER BY at DESC, id DESC LIMIT $1",projectId?[safeLimit,projectId]:[safeLimit]);return rows.rows.map(row=>({id:row.id,type:row.type,at:new Date(row.at).toISOString(),...(row.data??{}),...(row.projectId?{projectId:row.projectId}:{})}));}const matches:ActivityEvent[]=[];for(let i=activity.length-1;i>=0&&matches.length<safeLimit;i--){const event=activity[i];if(!projectId||event.projectId===projectId)matches.push(event);}return matches;}

export async function getCoordinationContext(projectId?:string):Promise<CoordinationContext|null>{
  let project:Project|null=null;
  if(projectId){project=await getProject(projectId);if(!project)return null;}
  const [agentList,taskList,contactList,toolList,resourceList,activityList,projectList]=await Promise.all([listAgents(),listTasks({ projectId }),listContacts(projectId),listTools(projectId),listResources(projectId),listActivity(50,projectId),projectId?Promise.resolve([]):listProjects()]);
  return {service:"Conduit",generatedAt:now(),project,projects:projectList,agents:agentList,tasks:taskList,contacts:contactList,tools:toolList,resources:resourceList,activity:activityList};
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (!value) return undefined;
  return new Date(value as string | Date).toISOString();
}

function normalizeProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    createdBy: row.createdBy as string,
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
    updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
    archivedAt: normalizeTimestamp(row.archivedAt),
  };
}

function normalizeResource(row: Record<string, unknown>): Resource {
  return {
    id: row.id as string,
    projectId: (row.projectId as string | null) ?? undefined,
    name: row.name as string,
    description: row.description as string,
    kind: row.kind as string,
    endpoint: (row.endpoint as string | null) ?? undefined,
    createdBy: row.createdBy as string,
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
    updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
    archivedAt: normalizeTimestamp(row.archivedAt),
  };
}

export async function getProject(projectId: string) {
  if (pool) {
    const row = (await pool.query("SELECT id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\",archived_at AS \"archivedAt\" FROM projects WHERE id=$1 AND archived_at IS NULL", [projectId])).rows[0];
    return row ? normalizeProject(row) : null;
  }
  const project = projects.get(projectId);
  return project && !project.archivedAt ? project : null;
}

export type ArchiveOptions = { asAdmin?: boolean };

export async function archiveProject(projectId: string, agentId: string, options?: ArchiveOptions) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async client => {
      const existing = (await client.query("SELECT id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\",archived_at AS \"archivedAt\" FROM projects WHERE id=$1 FOR UPDATE", [projectId])).rows[0] as Record<string, unknown> | undefined;
      if (!existing) return null;
      const createdBy = existing.createdBy as string;
      if (createdBy !== agentId && !options?.asAdmin) return null;
      if (existing.archivedAt) return normalizeProject(existing);
      const row = (await client.query("UPDATE projects SET archived_at=now(),updated_at=now() WHERE id=$1 RETURNING id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\",archived_at AS \"archivedAt\"", [projectId])).rows[0];
      const project = normalizeProject(row);
      await logWithClient(client, "project.archive", { projectId, agentId });
      return project;
    });
  }
  const project = projects.get(projectId);
  if (!project || (project.createdBy !== agentId && !options?.asAdmin)) return null;
  if (project.archivedAt) return project;
  const previous = { ...project };
  project.archivedAt = now();
  project.updatedAt = project.archivedAt;
  try { await log("project.archive", { projectId, agentId }); }
  catch (error) { Object.assign(project, previous); throw error; }
  return project;
}

export async function archiveResource(resourceId: string, agentId: string, options?: ArchiveOptions) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async client => {
      const existing = (await client.query("SELECT id,project_id AS \"projectId\",name,description,kind,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\",archived_at AS \"archivedAt\" FROM resources WHERE id=$1 FOR UPDATE", [resourceId])).rows[0] as Record<string, unknown> | undefined;
      if (!existing) return null;
      const createdBy = existing.createdBy as string;
      const projectId = (existing.projectId as string | null) ?? undefined;
      let projectCreator: string | undefined;
      if (projectId) {
        const projectRow = (await client.query("SELECT created_by AS \"createdBy\" FROM projects WHERE id=$1", [projectId])).rows[0] as { createdBy?: string } | undefined;
        projectCreator = projectRow?.createdBy;
      }
      if (createdBy !== agentId && projectCreator !== agentId && !options?.asAdmin) return null;
      if (existing.archivedAt) return normalizeResource(existing);
      const row = (await client.query("UPDATE resources SET archived_at=now(),updated_at=now() WHERE id=$1 RETURNING id,project_id AS \"projectId\",name,description,kind,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\",archived_at AS \"archivedAt\"", [resourceId])).rows[0];
      const resource = normalizeResource(row);
      await logWithClient(client, "resource.archive", { resourceId, agentId, ...(resource.projectId ? { projectId: resource.projectId } : {}) });
      return resource;
    });
  }
  const resource = resources.get(resourceId);
  if (!resource) return null;
  const parent = resource.projectId ? projects.get(resource.projectId) : undefined;
  if (resource.createdBy !== agentId && parent?.createdBy !== agentId && !options?.asAdmin) return null;
  if (resource.archivedAt) return resource;
  const previous = { ...resource };
  resource.archivedAt = now();
  resource.updatedAt = resource.archivedAt;
  try { await log("resource.archive", { resourceId, agentId, ...(resource.projectId ? { projectId: resource.projectId } : {}) }); }
  catch (error) { Object.assign(resource, previous); throw error; }
  return resource;
}

export async function getTask(taskId: string) {
  if (pool) { const row = (await pool.query(`SELECT ${taskSelect} FROM tasks WHERE id=$1`, [taskId])).rows[0]; return row ? normalizeTask(row) : null; }
  return tasks.get(taskId) || null;
}

export async function blockTask(taskId: string, agentId: string, reason?: string) {
  if (!(await agentExists(agentId))) return null;
  if (pool) {
    return withTransaction(async client => {
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
    return withTransaction(async client => {
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
