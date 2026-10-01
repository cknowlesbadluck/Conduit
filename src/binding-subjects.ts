import pg from "pg";
import { postgresSsl } from "./postgres-ssl.js";

const useDatabase = Boolean(process.env.DATABASE_URL) && process.env.CONDUIT_TEST_MEMORY !== "true";
const sslOption = postgresSsl();
const pool = useDatabase ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: sslOption, max: 2 }) : null;

/** In-memory fallback used when CONDUIT_TEST_MEMORY=true. registerAgent in store.ts also maintains boundAgentSubjects; this map is filled by rememberSubjectBinding. */
const memorySubjects = new Map<string, Set<string>>();

export function rememberSubjectBinding(agentId: string, subject: string) {
  const subjects = memorySubjects.get(agentId) ?? new Set<string>();
  subjects.add(subject);
  memorySubjects.set(agentId, subjects);
}

export async function listSubjectsForAgent(agentId: string): Promise<string[]> {
  if (pool) {
    const rows = (await pool.query("SELECT subject FROM agent_bindings WHERE agent_id=$1 ORDER BY subject", [agentId])).rows as { subject: string }[];
    return rows.map((r) => r.subject);
  }
  return [...(memorySubjects.get(agentId) ?? new Set<string>())].sort();
}
