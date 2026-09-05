import pg from "pg";

const { Pool } = pg;

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";
export type Agent = { id: string; name: string; description?: string; createdAt: string };
export type Project = { id: string; name: string; description: string; createdBy: string; createdAt: string; updatedAt: string };
export type Resource = { id: string; projectId?: string; name: string; description: string; kind: string; endpoint?: string; createdBy: string; createdAt: string; updatedAt: string };
export type Task = { id: string; projectId?: string; title: string; description: string; status: TaskStatus; createdBy: string; claimedBy?: string; createdAt: string; updatedAt: string };
export type Contact = { id: string; projectId?: string; name: string; value: string; kind: string; createdBy?: string; createdAt: string };
export type Tool = { id: string; projectId?: string; name: string; description: string; endpoint?: string; createdBy?: string; createdAt: string };
export type ActivityEvent = Record<string, string>;
export type CoordinationContext = { service: string; generatedAt: string; project: Project | null; projects: Project[]; agents: Agent[]; tasks: Task[]; contacts: Contact[]; tools: Tool[]; resources: Resource[]; activity: ActivityEvent[] };

const agents = new Map<string, Agent>();
const agentBindings = new Map<string, string>();
const projects = new Map<string, Project>();
const resources = new Map<string, Resource>();
const tasks = new Map<string, Task>();
const contacts: Contact[] = [];
const tools: Tool[] = [];
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
  if (pool) await pool.query("INSERT INTO activity(id,type,at,data,project_id) VALUES($1,$2,$3,$4,$5)", [event.id, type, event.at, JSON.stringify(data), data.projectId ?? null]);
  else activity.unshift(event);
}

export async function init() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS agent_bindings (subject text PRIMARY KEY, agent_id text NOT NULL UNIQUE REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
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
      CREATE INDEX IF NOT EXISTS activity_at_idx ON activity(at DESC);
      CREATE INDEX IF NOT EXISTS handoffs_task_idx ON handoffs(task_id, created_at DESC);
    `);
  }
  ready = true;
}

export async function registerAgent(input: { id: string; name: string; description?: string; actorSubject?: string }) {
  if (pool) {
    if (input.actorSubject) {
      const binding = (await pool.query("SELECT agent_id AS \"agentId\" FROM agent_bindings WHERE subject=$1", [input.actorSubject])).rows[0] as { agentId: string } | undefined;
      if (binding && binding.agentId !== input.id) return null;
      const claimedByOther = (await pool.query("SELECT subject FROM agent_bindings WHERE agent_id=$1 AND subject<>$2", [input.id, input.actorSubject])).rows[0];
      if (claimedByOther) return null;
    }
    await pool.query("INSERT INTO agents(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description", [input.id, input.name, input.description ?? null]);
    if (input.actorSubject) await pool.query("INSERT INTO agent_bindings(subject,agent_id) VALUES($1,$2) ON CONFLICT(subject) DO UPDATE SET agent_id=EXCLUDED.agent_id", [input.actorSubject, input.id]);
  } else {
    const existingBinding = input.actorSubject ? agentBindings.get(input.actorSubject) : undefined;
    const otherBinding = input.actorSubject ? [...agentBindings.entries()].find(([subject, agentId]) => subject !== input.actorSubject && agentId === input.id) : undefined;
    if ((existingBinding && existingBinding !== input.id) || otherBinding) return null;
    agents.set(input.id, { id: input.id, name: input.name, description: input.description, createdAt: agents.get(input.id)?.createdAt ?? now() });
    if (input.actorSubject) agentBindings.set(input.actorSubject, input.id);
  }
  const agent = pool ? (await pool.query("SELECT id,name,description,created_at AS \"createdAt\" FROM agents WHERE id=$1", [input.id])).rows[0] as Agent : agents.get(input.id)!;
  await log("agent.register", { agentId: input.id });
  return agent;
}

export async function getBoundAgentId(actorSubject: string) {
  if (pool) return (await pool.query("SELECT agent_id AS \"agentId\" FROM agent_bindings WHERE subject=$1", [actorSubject])).rows[0]?.agentId as string | undefined;
  return agentBindings.get(actorSubject);
}

export async function listAgents() {
  if (pool) return (await pool.query("SELECT id,name,description,created_at AS \"createdAt\" FROM agents ORDER BY created_at DESC")).rows;
  return [...agents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function agentExists(agentId: string) { if (pool) return Boolean((await pool.query("SELECT 1 FROM agents WHERE id=$1", [agentId])).rowCount); return agents.has(agentId); }
async function projectExists(projectId: string) { if (pool) return Boolean((await pool.query("SELECT 1 FROM projects WHERE id=$1", [projectId])).rowCount); return projects.has(projectId); }

export async function createProject(input: { name: string; description?: string; createdBy: string }) {
  if (!(await agentExists(input.createdBy))) return null;
  const p: Project = { id:id("project"), name:input.name, description:input.description??"", createdBy:input.createdBy, createdAt:now(), updatedAt:now() };
  if(pool) await pool.query("INSERT INTO projects(id,name,description,created_by) VALUES($1,$2,$3,$4)",[p.id,p.name,p.description,p.createdBy]); else projects.set(p.id,p);
  await log("project.create",{projectId:p.id,agentId:p.createdBy}); return p;
}
export async function listProjects(){if(pool)return(await pool.query("SELECT id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM projects ORDER BY created_at DESC")).rows;return[...projects.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

export async function registerResource(input:{projectId?:string;name:string;description:string;kind:string;endpoint?:string;createdBy:string}){
  if(!(await agentExists(input.createdBy))||(input.projectId&&!(await projectExists(input.projectId))))return null;
  const r:Resource={id:id("resource"),projectId:input.projectId,name:input.name,description:input.description,kind:input.kind,endpoint:input.endpoint,createdBy:input.createdBy,createdAt:now(),updatedAt:now()};
  if(pool)await pool.query("INSERT INTO resources(id,project_id,name,description,kind,endpoint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[r.id,r.projectId??null,r.name,r.description,r.kind,r.endpoint??null,r.createdBy]);else resources.set(r.id,r);
  await log("resource.register",{resourceId:r.id,agentId:r.createdBy,...(r.projectId?{projectId:r.projectId}:{})});return r;
}
export async function listResources(projectId?:string){if(pool)return(await pool.query("SELECT id,project_id AS \"projectId\",name,description,kind,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM resources"+(projectId?" WHERE project_id=$1":"")+" ORDER BY created_at DESC",projectId?[projectId]:[])).rows;return[...resources.values()].filter(r=>!projectId||r.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

export async function createTask(input:{title:string;description?:string;createdBy:string;projectId?:string}){if(!(await agentExists(input.createdBy))||(input.projectId&&!(await projectExists(input.projectId))))return null;const t:Task={id:id("task"),projectId:input.projectId,title:input.title,description:input.description??"",status:"open",createdBy:input.createdBy,createdAt:now(),updatedAt:now()};if(pool)await pool.query("INSERT INTO tasks(id,project_id,title,description,status,created_by) VALUES($1,$2,$3,$4,$5,$6)",[t.id,t.projectId??null,t.title,t.description,t.status,t.createdBy]);else tasks.set(t.id,t);await log("task.create",{taskId:t.id,agentId:t.createdBy,...(t.projectId?{projectId:t.projectId}:{})});return t;}
export async function listTasks(status?:TaskStatus,projectId?:string){if(pool){const conditions:string[]=[];const params:string[]=[];if(status){conditions.push(`status=$${params.length+1}`);params.push(status);}if(projectId){conditions.push(`project_id=$${params.length+1}`);params.push(projectId);}const sql="SELECT id,project_id AS \"projectId\",title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM tasks"+(conditions.length?` WHERE ${conditions.join(" AND ")}`:"")+" ORDER BY created_at DESC";return(await pool.query(sql,params)).rows;}return[...tasks.values()].filter(t=>(!status||t.status===status)&&(!projectId||t.projectId===projectId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

export async function claimTask(taskId:string,agentId:string){if(!(await agentExists(agentId)))return null;if(pool){const r=await pool.query("UPDATE tasks SET status='claimed',claimed_by=$2,updated_at=now() WHERE id=$1 AND status='open' RETURNING id,project_id AS \"projectId\",title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"",[taskId,agentId]);if(!r.rowCount)return null;await log("task.claim",{taskId,agentId});return r.rows[0] as Task;}const t=tasks.get(taskId);if(!t||t.status!=="open")return null;t.status="claimed";t.claimedBy=agentId;t.updatedAt=now();await log("task.claim",{taskId,agentId});return t;}
export async function completeTask(taskId:string,agentId:string){if(pool){const r=await pool.query("UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND claimed_by=$2 AND status='claimed' RETURNING id,project_id AS \"projectId\",title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"",[taskId,agentId]);if(!r.rowCount)return null;await log("task.complete",{taskId,agentId});return r.rows[0] as Task;}const t=tasks.get(taskId);if(!t||t.status!=="claimed"||t.claimedBy!==agentId)return null;t.status="completed";t.updatedAt=now();await log("task.complete",{taskId,agentId});return t;}
export async function handoff(taskId:string,fromAgent:string,toAgent:string,note?:string){if(fromAgent===toAgent)return null;if(!(await agentExists(fromAgent))||!(await agentExists(toAgent)))return null;if(pool){const client=await pool.connect();try{await client.query("BEGIN");const task=(await client.query("SELECT id,project_id AS \"projectId\",title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM tasks WHERE id=$1 FOR UPDATE",[taskId])).rows[0] as Task|undefined;if(!task||task.status!=="claimed"||task.claimedBy!==fromAgent){await client.query("ROLLBACK");return null;}const updated=(await client.query("UPDATE tasks SET claimed_by=$2,updated_at=now() WHERE id=$1 RETURNING id,project_id AS \"projectId\",title,description,status,created_by AS \"createdBy\",claimed_by AS \"claimedBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"",[taskId,toAgent])).rows[0] as Task;await client.query("INSERT INTO handoffs(id,task_id,from_agent,to_agent,note) VALUES($1,$2,$3,$4,$5)",[id("handoff"),taskId,fromAgent,toAgent,note??null]);await client.query("COMMIT");await log("task.handoff",{taskId,agentId:fromAgent,toAgent,note:note??"",...(task.projectId?{projectId:task.projectId}:{})});return{...updated,handoffNote:note??""};}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}const t=tasks.get(taskId);if(!t||t.status!=="claimed"||t.claimedBy!==fromAgent)return null;t.claimedBy=toAgent;t.updatedAt=now();await log("task.handoff",{taskId,agentId:fromAgent,toAgent,note:note??"",...(t.projectId?{projectId:t.projectId}:{})});return{...t,handoffNote:note??""};}

export async function addContact(name:string,value:string,kind:string,projectId?:string,createdBy?:string){if((projectId&&!(await projectExists(projectId)))||(createdBy&&!(await agentExists(createdBy))))return null;const c:Contact={id:id("contact"),projectId,name,value,kind,createdBy,createdAt:now()};if(pool)await pool.query("INSERT INTO contacts(id,project_id,name,value,kind,created_by) VALUES($1,$2,$3,$4,$5,$6)",[c.id,c.projectId??null,name,value,kind,createdBy??null]);else contacts.unshift(c);await log("contact.add",{contactId:c.id,...(projectId?{projectId}:{}),...(createdBy?{agentId:createdBy}:{})});return c;}
export async function listContacts(projectId?:string){if(pool)return(await pool.query("SELECT id,project_id AS \"projectId\",name,value,kind,created_by AS \"createdBy\",created_at AS \"createdAt\" FROM contacts"+(projectId?" WHERE project_id=$1":"")+" ORDER BY created_at DESC",projectId?[projectId]:[])).rows;return contacts.filter(c=>!projectId||c.projectId===projectId);}
export async function registerTool(name:string,description:string,endpoint?:string,projectId?:string,createdBy?:string){if((projectId&&!(await projectExists(projectId)))||(createdBy&&!(await agentExists(createdBy))))return null;const t:Tool={id:id("tool"),projectId,name,description,endpoint,createdBy,createdAt:now()};if(pool)await pool.query("INSERT INTO tools(id,project_id,name,description,endpoint,created_by) VALUES($1,$2,$3,$4,$5,$6)",[t.id,t.projectId??null,name,description,endpoint??null,createdBy??null]);else tools.unshift(t);await log("tool.register",{toolId:t.id,...(projectId?{projectId}:{}),...(createdBy?{agentId:createdBy}:{})});return t;}
export async function listTools(projectId?:string){if(pool)return(await pool.query("SELECT id,project_id AS \"projectId\",name,description,endpoint,created_by AS \"createdBy\",created_at AS \"createdAt\" FROM tools"+(projectId?" WHERE project_id=$1":"")+" ORDER BY created_at DESC",projectId?[projectId]:[])).rows;return tools.filter(t=>!projectId||t.projectId===projectId);}
export async function listActivity(limit=50,projectId?:string){const safeLimit=Math.max(1,Math.min(limit,200));if(pool){const rows=await pool.query("SELECT id,type,at,data,project_id AS \"projectId\" FROM activity"+(projectId?" WHERE project_id=$2":"")+" ORDER BY at DESC LIMIT $1",projectId?[safeLimit,projectId]:[safeLimit]);return rows.rows.map(row=>({id:row.id,type:row.type,at:new Date(row.at).toISOString(),...(row.data??{}),...(row.projectId?{projectId:row.projectId}:{})}));}return activity.filter(e=>!projectId||e.projectId===projectId).slice(0,safeLimit);}

export async function getCoordinationContext(projectId?:string):Promise<CoordinationContext|null>{
  let project:Project|null=null;
  if(projectId){project=pool?(await pool.query("SELECT id,name,description,created_by AS \"createdBy\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM projects WHERE id=$1",[projectId])).rows[0] as Project|undefined ?? null:projects.get(projectId)??null;if(!project)return null;}
  const [agentList,taskList,contactList,toolList,resourceList,activityList,projectList]=await Promise.all([listAgents(),listTasks(undefined,projectId),listContacts(projectId),listTools(projectId),listResources(projectId),listActivity(50,projectId),projectId?Promise.resolve([]):listProjects()]);
  return {service:"Conduit",generatedAt:now(),project,projects:projectList,agents:agentList,tasks:taskList,contacts:contactList,tools:toolList,resources:resourceList,activity:activityList};
}
