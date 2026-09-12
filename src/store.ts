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
const boundAgentSubjects = new Map<string, string>();
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

/** Live readiness: init completed, and the database answers when configured. */
export async function checkReady(): Promise<boolean> {
  if (!ready) return false;
  if (!pool) return true;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeStore(): Promise<void> {
  ready = false;
  if (pool) await pool.end();
}
