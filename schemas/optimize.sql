-- Database optimization migration for existing installs.
-- Adds missing indexes, replaces FTS triggers with conditional variants,
-- and drops unused indexes. Safe to run multiple times (all IF NOT EXISTS / IF EXISTS).
-- New installs already get these via schema.sql.

-- 1. New indexes for query performance
CREATE INDEX IF NOT EXISTS idx_namespaces_name ON namespaces(name);
CREATE INDEX IF NOT EXISTS idx_memories_recall ON memories(namespace_id, last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_ns_updated ON conversations(namespace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_relations_ns_weight ON relations(namespace_id, weight DESC);

-- 2. Drop unused indexes (FTS5 handles name search; no query uses (namespace_id, relation_type) alone)
DROP INDEX IF EXISTS idx_entities_name;
DROP INDEX IF EXISTS idx_relations_type;

-- 3. Replace FTS update triggers with conditional variants.
--    The old triggers fire on every UPDATE (including access-count bumps),
--    causing unnecessary FTS churn. The new triggers only fire when searchable
--    columns actually change.

DROP TRIGGER IF EXISTS entities_fts_update;
CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities
  WHEN old.name != new.name OR old.type != new.type
       OR COALESCE(old.summary, '') != COALESCE(new.summary, '')
BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, type, summary)
    VALUES ('delete', old.rowid, old.name, old.type, old.summary);
  INSERT INTO entities_fts(rowid, name, type, summary)
    VALUES (new.rowid, new.name, new.type, new.summary);
END;

DROP TRIGGER IF EXISTS memories_fts_update;
CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories
  WHEN old.content != new.content
BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

DROP TRIGGER IF EXISTS messages_fts_update;
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages
  WHEN old.content != new.content
BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- 4. Update query planner statistics for optimal index usage.
--    Cloudflare recommends running this after any schema/index changes.
PRAGMA optimize;
