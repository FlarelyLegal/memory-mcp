-- Migration: add visibility column to namespaces table.
-- Idempotent: safe to run on databases that already have the column.
-- Default 'private' preserves existing behavior for all current namespaces.

ALTER TABLE namespaces ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
CREATE INDEX IF NOT EXISTS idx_namespaces_visibility ON namespaces(visibility);
