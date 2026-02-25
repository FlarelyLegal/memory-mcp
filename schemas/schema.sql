-- Memory Graph MCP - D1 Schema
-- Supports: namespaces, entities, relations, conversations, and temporal memory

PRAGMA foreign_keys = ON;

-- Namespaces provide flexible scoping (per-user, per-project, shared, etc.)
CREATE TABLE IF NOT EXISTS namespaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  metadata TEXT, -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Entities are the nodes of the graph
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,        -- "person", "concept", "project", "tool", "location", etc.
  summary TEXT,              -- short description for context injection
  metadata TEXT,             -- JSON blob for arbitrary properties
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  access_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entities_namespace ON entities(namespace_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(namespace_id, type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(namespace_id, name);

-- Relations are the edges of the graph
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,  -- "knows", "uses", "depends_on", "part_of", etc.
  weight REAL NOT NULL DEFAULT 1.0,
  metadata TEXT,               -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(namespace_id, source_id, target_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(namespace_id, relation_type);

-- Conversations track interaction history
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  title TEXT,
  metadata TEXT,  -- JSON (model, system prompt hash, etc.)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_conversations_namespace ON conversations(namespace_id);

-- Messages within conversations
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,          -- "user", "assistant", "system", "tool"
  content TEXT NOT NULL,
  metadata TEXT,               -- JSON (token count, model, tool calls, etc.)
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- Memories are standalone knowledge fragments (facts, observations, preferences)
-- These bridge unstructured recall and structured graph
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'fact',  -- "fact", "observation", "preference", "instruction"
  source TEXT,                         -- where this came from (conversation_id, manual, etc.)
  importance REAL NOT NULL DEFAULT 0.5, -- 0.0-1.0, used in decay/ranking
  metadata TEXT,                        -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  access_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(namespace_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(namespace_id, importance DESC);

-- Link memories to entities they reference
CREATE TABLE IF NOT EXISTS memory_entity_links (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_mel_entity ON memory_entity_links(entity_id);
