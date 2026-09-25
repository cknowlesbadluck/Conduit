CREATE TABLE IF NOT EXISTS agents (id text PRIMARY KEY, name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS agent_bindings (subject text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS resources (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, kind text NOT NULL, endpoint text, created_by text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tasks (id text PRIMARY KEY, project_id text REFERENCES projects(id), title text NOT NULL, description text NOT NULL, status text NOT NULL CHECK (status IN ('open','claimed','blocked','completed')), created_by text NOT NULL REFERENCES agents(id), claimed_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS handoffs (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), from_agent text NOT NULL REFERENCES agents(id), to_agent text NOT NULL REFERENCES agents(id), note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS contacts (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, value text NOT NULL, kind text NOT NULL, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tools (id text PRIMARY KEY, project_id text REFERENCES projects(id), name text NOT NULL, description text NOT NULL, endpoint text, created_by text REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS activity (id text PRIMARY KEY, type text NOT NULL, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL DEFAULT '{}'::jsonb, project_id text REFERENCES projects(id));

-- Upgrade the schemas used before Conduit 0.8 as well as creating a fresh database.
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
CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks(status,created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_claimed_by_created_idx ON tasks(claimed_by,created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_created_by_created_idx ON tasks(created_by,created_at DESC);
CREATE INDEX IF NOT EXISTS activity_at_idx ON activity(at DESC);
CREATE INDEX IF NOT EXISTS handoffs_task_idx ON handoffs(task_id,created_at DESC);
