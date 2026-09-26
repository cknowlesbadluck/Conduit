CREATE TABLE IF NOT EXISTS capability_grants (
  id text PRIMARY KEY,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  provider text NOT NULL,
  method text NOT NULL,
  path_pattern text NOT NULL,
  expires_at timestamptz,
  created_by text NOT NULL REFERENCES agents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS capability_grants_agent_idx ON capability_grants(agent_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS capability_grants_provider_idx ON capability_grants(provider,method,created_at DESC);
