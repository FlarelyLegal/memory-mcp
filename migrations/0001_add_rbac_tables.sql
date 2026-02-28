PRAGMA foreign_keys = ON;

-- Groups (teams/organizations)
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  avatar_url TEXT,
  privacy TEXT NOT NULL DEFAULT 'visible'
    CHECK (privacy IN ('visible', 'hidden')),
  parent_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  settings TEXT,
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
