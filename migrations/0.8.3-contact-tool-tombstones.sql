ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS contacts_live_created_idx ON contacts(created_at DESC,id DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tools_live_created_idx ON tools(created_at DESC,id DESC) WHERE archived_at IS NULL;
