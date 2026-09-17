/** Idempotent production migration: one logical agent may have many actor subjects. */
export const DROP_AGENT_ID_UNIQUE_SQL = `
ALTER TABLE agent_bindings DROP CONSTRAINT IF EXISTS agent_bindings_agent_id_key;
CREATE INDEX IF NOT EXISTS agent_bindings_agent_id_idx ON agent_bindings(agent_id);
INSERT INTO schema_migrations(version) VALUES('0.8.1-drop-agent-id-unique') ON CONFLICT (version) DO NOTHING;
`;

export const AGENT_BINDINGS_CREATE_SQL =
  "CREATE TABLE IF NOT EXISTS agent_bindings (subject text PRIMARY KEY, agent_id text NOT NULL REFERENCES agents(id), created_at timestamptz NOT NULL DEFAULT now())";
