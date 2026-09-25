ALTER TABLE agent_bindings DROP CONSTRAINT IF EXISTS agent_bindings_agent_id_key;
CREATE INDEX IF NOT EXISTS agent_bindings_agent_id_idx ON agent_bindings(agent_id);
