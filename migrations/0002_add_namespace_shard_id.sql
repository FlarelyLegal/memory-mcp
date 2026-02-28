PRAGMA foreign_keys = ON;

ALTER TABLE namespaces ADD COLUMN shard_id TEXT;

UPDATE namespaces
SET shard_id = 'core'
WHERE shard_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_namespaces_shard ON namespaces(shard_id);
