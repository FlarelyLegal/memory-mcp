-- Memory Graph MCP - D1 Schema
-- Supports: namespaces, entities, relations, conversations, and temporal memory

PRAGMA foreign_keys = ON;

-- Namespaces provide flexible scoping (per-user, per-project, shared, etc.)
CREATE TABLE IF NOT EXISTS namespaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner TEXT,       -- email of the owning user (NULL = legacy/unowned)
  visibility TEXT NOT NULL DEFAULT 'private', -- 'private' | 'public'
  metadata TEXT,    -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_namespaces_owner ON namespaces(owner);
CREATE INDEX IF NOT EXISTS idx_namespaces_name ON namespaces(name);
CREATE INDEX IF NOT EXISTS idx_namespaces_visibility ON namespaces(visibility);

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

-- Relations are the edges of the graph
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,  -- "knows", "uses", "depends_on", "part_of", etc.
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0),
  metadata TEXT,               -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(namespace_id, source_id, target_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_ns_weight ON relations(namespace_id, weight DESC);

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
CREATE INDEX IF NOT EXISTS idx_conversations_ns_updated ON conversations(namespace_id, updated_at DESC);

-- Messages within conversations
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
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
  type TEXT NOT NULL DEFAULT 'fact' CHECK (type IN ('fact', 'observation', 'preference', 'instruction')),
  source TEXT,                         -- where this came from (conversation_id, manual, etc.)
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0.0 AND importance <= 1.0),
  metadata TEXT,                        -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  access_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(namespace_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(namespace_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_recall ON memories(namespace_id, last_accessed_at DESC);

-- Link memories to entities they reference
CREATE TABLE IF NOT EXISTS memory_entity_links (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_mel_entity ON memory_entity_links(entity_id);

-- Audit log for tracking write operations (hot window; cold archive in R2)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  namespace_id TEXT,                -- NULL for global events (claim, admin)
  email TEXT NOT NULL,
  action TEXT NOT NULL,             -- 'entity.create', 'relation.delete', etc.
  resource_type TEXT,               -- 'entity', 'relation', 'memory', 'conversation', 'message', 'namespace'
  resource_id TEXT,                 -- ID of affected resource (NULL for bulk ops)
  detail TEXT,                      -- JSON blob for action-specific context
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_namespace ON audit_logs(namespace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_email ON audit_logs(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- Groups (teams/organizations)
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  avatar_url TEXT,
  privacy TEXT NOT NULL DEFAULT 'visible' -- 'visible' | 'hidden' (hidden = stealth/admin groups)
    CHECK (privacy IN ('visible', 'hidden')),
  parent_group_id TEXT                    -- hierarchical groups (engineering > backend > infra)
    REFERENCES groups(id) ON DELETE SET NULL,
  settings TEXT,                          -- JSON (default_role, notification prefs, max_members, etc.)
  member_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_groups_slug ON groups(slug);
CREATE INDEX IF NOT EXISTS idx_groups_parent ON groups(parent_group_id);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);
CREATE INDEX IF NOT EXISTS idx_groups_deleted ON groups(deleted_at) WHERE deleted_at IS NOT NULL;

-- Group membership
CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended')),
  invited_by TEXT,
  invited_at INTEGER,
  accepted_at INTEGER,
  expires_at INTEGER,
  metadata TEXT,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(group_id, email)
);
CREATE INDEX IF NOT EXISTS idx_gm_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_gm_email ON group_members(email);
CREATE INDEX IF NOT EXISTS idx_gm_status ON group_members(status);
CREATE INDEX IF NOT EXISTS idx_gm_expires ON group_members(expires_at) WHERE expires_at IS NOT NULL;

-- Access grants: user OR group -> namespace + role
CREATE TABLE IF NOT EXISTS namespace_grants (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  email TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked', 'suspended')),
  expires_at INTEGER,
  inherited_from TEXT,
  condition TEXT,
  granted_by TEXT NOT NULL,
  revoked_by TEXT,
  revoked_at INTEGER,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (email IS NOT NULL OR group_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ng_namespace ON namespace_grants(namespace_id);
CREATE INDEX IF NOT EXISTS idx_ng_email ON namespace_grants(email);
CREATE INDEX IF NOT EXISTS idx_ng_group ON namespace_grants(group_id);
CREATE INDEX IF NOT EXISTS idx_ng_status ON namespace_grants(status);
CREATE INDEX IF NOT EXISTS idx_ng_expires ON namespace_grants(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ng_ns_status ON namespace_grants(namespace_id, status);

-- Duplicate-prevention: only one active grant per principal + namespace.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ng_active_direct_unique
  ON namespace_grants(namespace_id, email)
  WHERE status = 'active' AND email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ng_active_group_unique
  ON namespace_grants(namespace_id, group_id)
  WHERE status = 'active' AND group_id IS NOT NULL;

-- FTS5 full-text search indexes (BM25 ranking, much faster than LIKE)
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name, type, summary,
  content='entities', content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories', content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages', content_rowid='rowid'
);

-- Triggers to keep FTS indexes in sync
CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, type, summary)
    VALUES (new.rowid, new.name, new.type, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, type, summary)
    VALUES ('delete', old.rowid, old.name, old.type, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS entities_fts_update AFTER UPDATE ON entities
  WHEN old.name != new.name OR old.type != new.type
       OR COALESCE(old.summary, '') != COALESCE(new.summary, '')
BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, type, summary)
    VALUES ('delete', old.rowid, old.name, old.type, old.summary);
  INSERT INTO entities_fts(rowid, name, type, summary)
    VALUES (new.rowid, new.name, new.type, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories
  WHEN old.content != new.content
BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages
  WHEN old.content != new.content
BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
