-- Audit log table for tracking all write operations.
-- Hot queryable window in D1; cold archive in R2 (NDJSON, Loki-compatible).

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
