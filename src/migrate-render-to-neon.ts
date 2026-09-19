import pg from "pg";

const { Pool } = pg;

const TABLES = [
  "schema_migrations",
  "agents",
  "agent_bindings",
  "projects",
  "resources",
  "tasks",
  "handoffs",
  "contacts",
  "tools",
  "activity",
] as const;

const DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_bindings (subject text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz);
CREATE TABLE IF NOT EXISTS resources (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, kind text NOT NULL, endpoint text, created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz);
CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, project_id text REFERENCES projects(id), title text NOT NULL, description text NOT NULL, status text NOT NULL CHECK (status IN ('open','claimed','blocked','completed')), created_by text NOT NULL REFERENCES agents(id), claimed_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS handoffs (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), from_agent text NOT NULL REFERENCES agents(id), to_agent text NOT NULL REFERENCES agents(id), note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS contacts (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, value text NOT NULL, kind text NOT NULL, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tools (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, endpoint text, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS activity (id text PRIMARY KEY, type text NOT NULL, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL DEFAULT '{}'::jsonb, project_id text REFERENCES projects(id));
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
CREATE INDEX IF NOT EXISTS agent_bindings_agent_id_idx ON agent_bindings(agent_id);
CREATE INDEX IF NOT EXISTS projects_live_created_idx ON projects(created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS resources_live_created_idx ON resources(created_at DESC, id DESC) WHERE archived_at IS NULL;
`;

function makePool(connectionString: string) {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 4,
  });
}

export async function migrateRenderDatabaseToNeon(): Promise<Record<string, unknown>> {
  const sourceUrl = process.env.DATABASE_URL;
  const targetUrl = process.env.NEON_MIGRATION_DATABASE_URL;
  if (!sourceUrl || !targetUrl) throw new Error("migration_database_urls_missing");

  const source = makePool(sourceUrl);
  const target = makePool(targetUrl);
  const counts: Record<string, number> = {};

  try {
    await source.query("SELECT 1");
    await target.query("SELECT 1");
    await target.query(DDL);

    await target.query("TRUNCATE schema_migrations, agents, agent_bindings, projects, resources, tasks, handoffs, contacts, tools, activity CASCADE");

    await target.query("BEGIN");
    try {
      for (const table of TABLES) {
        const rows = (await source.query(`SELECT row_to_json(t) AS row FROM ${table} t`)).rows.map(r => r.row as Record<string, unknown>);
        counts[table] = rows.length;
        for (const row of rows) {
          const columns = Object.keys(row);
          if (!columns.length) continue;
          const quoted = columns.map(c => `"${c.replaceAll('"', '""')}"`).join(",");
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
          await target.query(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`, columns.map(c => row[c]));
        }
      }
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }

    const verification: Record<string, number> = {};
    for (const table of TABLES) {
      verification[table] = Number((await target.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)).rows[0].n);
    }

    return { ok: true, counts, verification };
  } finally {
    await source.end();
    await target.end();
  }
}
