import pg from "pg";

const { Pool } = pg;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
export type Agent = { id: string; name: string; description?: string; createdAt: string };
export type Task = { id: string; title: string; description: string; status: TaskStatus; createdBy: string; claimedBy?: string; createdAt: string; updatedAt: string };

const agents = new Map<string, Agent>();
const tasks = new Map<string, Task>();
const contacts: Array<Record<string, string>> = [];
const tools: Array<Record<string, string>> = [];
const activity: Array<Record<string, string>> = [];
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const log = (type: string, data: Record<string, string>) => activity.unshift({ id: id("evt"), type, at: now(), ...data });

export async function init() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS agents (id text primary key, name text not null, description text, created_at timestamptz not null default now());
    CREATE TABLE IF NOT EXISTS tasks (id text primary key, title text not null, description text not null, status text not null, created_by text not null, claimed_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    CREATE TABLE IF NOT EXISTS handoffs (id text primary key, task_id text not null, from_agent text not null, to_agent text not null, note text, created_at timestamptz not null default now());
    CREATE TABLE IF NOT EXISTS contacts (id text primary key, name text not null, value text not null, kind text not null, created_at timestamptz not null default now());
    CREATE TABLE IF NOT EXISTS tools (id text primary key, name text not null, description text, endpoint text, created_at timestamptz not null default now());`);
}

export async function registerAgent(a: { id: string; name: string; description?: string }) {
  const createdAt = now();
  const agent = { ...a, createdAt };
  if (pool) await pool.query("INSERT INTO agents(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=$2,description=$3", [a.id,a.name,a.description ?? null]);
  else agents.set(a.id, agent);
  log("agent.register", { agentId: a.id });
  return agent;
}

export async function listAgents() {
  if (pool) return (await pool.query("SELECT id,name,description,created_at AS \"createdAt\" FROM agents ORDER BY created_at DESC")).rows;
  return [...agents.values()];
}

export async function createTask(input: { title: string; description?: string; createdBy: string }) {
  const t: Task = { id: id("task"), title: input.title, description: input.description ?? "", status: "open", createdBy: input.createdBy, createdAt: now(), updatedAt: now() };
  if (pool) await pool.query("INSERT INTO tasks(id,title,description,status,created_by) VALUES($1,$2,$3,$4,$5)",[t.id,t.title,t.description,t.status,t.createdBy]); else tasks.set(t.id,t);
  log("task.create", { taskId:t.id, agentId:t.createdBy });
  return t;
}

export async function listTasks(status?: TaskStatus) {
  if (pool) return (await pool.query(status ? "SELECT id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM tasks WHERE status=$1 ORDER BY created_at DESC" : "SELECT id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM tasks ORDER BY created_at DESC", status ? [status] : [])).rows;
  return [...tasks.values()].filter(t => !status || t.status === status).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export async function claimTask(taskId: string, agentId: string) {
  if (pool) {
    const r = await pool.query("UPDATE tasks SET status='claimed',claimed_by=$2,updated_at=now() WHERE id=$1 AND status='open' RETURNING id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"", [taskId,agentId]);
    if (!r.rowCount) return null;
    log("task.claim", { taskId, agentId }); return r.rows[0];
  }
  const t = tasks.get(taskId); if (!t || t.status !== "open") return null;
  t.status="claimed"; t.claimedBy=agentId; t.updatedAt=now(); log("task.claim",{taskId,agentId}); return t;
}

export async function completeTask(taskId: string, agentId: string) {
  if (pool) {
    const r = await pool.query("UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND claimed_by=$2 AND status='claimed' RETURNING id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"", [taskId,agentId]);
    if (!r.rowCount) return null; log("task.complete",{taskId,agentId}); return r.rows[0];
  }
  const t=tasks.get(taskId); if(!t || t.status!=="claimed" || t.claimedBy!==agentId) return null; t.status="completed"; t.updatedAt=now(); log("task.complete",{taskId,agentId}); return t;
}

export async function handoff(taskId:string, fromAgent:string, toAgent:string, note?:string) {
  const t = pool ? (await pool.query("SELECT id,title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM tasks WHERE id=$1",[taskId])).rows[0] : tasks.get(taskId);
  if (!t) return null;
  if (pool) await pool.query("UPDATE tasks SET claimed_by=$2,updated_at=now() WHERE id=$1",[taskId,toAgent]); else { t.claimedBy=toAgent; t.status="claimed"; t.updatedAt=now(); }
  log("task.handoff",{taskId,agentId:fromAgent,toAgent,note:note??""}); return { ...t, claimedBy: toAgent, handoffNote: note ?? "" };
}

export async function addContact(name:string,value:string,kind:string){const c={id:id("contact"),name,value,kind,createdAt:now()}; if(pool) await pool.query("INSERT INTO contacts(id,name,value,kind) VALUES($1,$2,$3,$4)",[c.id,name,value,kind]); else contacts.unshift(c); return c;}
export async function listContacts(){if(pool)return (await pool.query("SELECT id,name,value,kind,created_at AS \"createdAt\" FROM contacts ORDER BY created_at DESC")).rows;return contacts;}
export async function registerTool(name:string,description:string,endpoint?:string){const t={id:id("tool"),name,description,endpoint:endpoint??"",createdAt:now()};if(pool)await pool.query("INSERT INTO tools(id,name,description,endpoint) VALUES($1,$2,$3,$4)",[t.id,name,description,endpoint??null]);else tools.unshift(t);return t;}
export async function listTools(){if(pool)return (await pool.query("SELECT id,name,description,endpoint,created_at AS \"createdAt\" FROM tools ORDER BY created_at DESC")).rows;return tools;}
export async function listActivity(limit=50){return activity.slice(0,Math.max(1,Math.min(limit,200)));}
