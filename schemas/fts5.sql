-- FTS5 full-text search indexes for entities, memories, and messages.
-- Uses external content tables to avoid data duplication.
-- Apply this migration to existing databases; new installs get it via schema.sql.

-- Entity FTS: searchable by name, type, summary
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name, type, summary,
  content='entities', content_rowid='rowid'
);

-- Memory FTS: searchable by content
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories', content_rowid='rowid'
);

-- Message FTS: searchable by content
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages', content_rowid='rowid'
);

-- Triggers to keep FTS indexes in sync with source tables.
-- Entity triggers
CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, type, summary)
    VALUES (new.rowid, new.name, new.type, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, type, summary)
    VALUES ('delete', old.rowid, old.name, old.type, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, type, summary)
    VALUES ('delete', old.rowid, old.name, old.type, old.summary);
  INSERT INTO entities_fts(rowid, name, type, summary)
    VALUES (new.rowid, new.name, new.type, new.summary);
END;

-- Memory triggers
CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Message triggers
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Rebuild FTS indexes from existing data (idempotent).
-- This populates the FTS tables for rows that existed before the triggers.
INSERT INTO entities_fts(entities_fts) VALUES ('rebuild');
INSERT INTO memories_fts(memories_fts) VALUES ('rebuild');
INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
