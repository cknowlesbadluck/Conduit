ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS projects_live_created_idx ON projects(created_at DESC,id DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS resources_live_created_idx ON resources(created_at DESC,id DESC) WHERE archived_at IS NULL;
