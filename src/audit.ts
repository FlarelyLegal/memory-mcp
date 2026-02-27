/**
 * Audit logging — D1 hot window + R2 NDJSON cold archive.
 *
 * All write operations are audit-logged via `audit()`. Each call:
 * 1. Inserts a row into the D1 `audit_logs` table (queryable hot window).
 * 2. Appends an NDJSON line to R2 at `audit/{YYYY-MM-DD}.ndjson` (Loki-compatible cold archive).
 *
 * Both writes are best-effort — failures never break the request flow.
 */
import type { DbHandle } from "./db.js";
import type { AuditLogRow } from "./types.js";
import { generateId, now } from "./utils.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AuditAction =
  // Namespace
  | "namespace.create"
  | "namespace.claim"
  // Entity
  | "entity.create"
  | "entity.update"
  | "entity.delete"
  // Relation
  | "relation.create"
  | "relation.delete"
  // Memory
  | "memory.create"
  | "memory.update"
  | "memory.delete"
  // Conversation
  | "conversation.create"
  | "conversation.delete"
  // Message
  | "message.create"
  // Admin / workflow
  | "workflow.reindex"
  | "workflow.consolidate"
  | "audit.purge"
  // Service token (kept for backward compat with existing R2 audit)
  | "service_token.bind_request"
  | "service_token.bind_self"
  | "service_token.bind_denied"
  | "service_token.bind_conflict"
  | "service_token.update"
  | "service_token.revoke";

export type ResourceType =
  | "namespace"
  | "entity"
  | "relation"
  | "memory"
  | "conversation"
  | "message"
  | "service_token"
  | "workflow";

export interface AuditEntry {
  action: AuditAction;
  email: string;
  namespace_id?: string | null;
  resource_type?: ResourceType | null;
  resource_id?: string | null;
  detail?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Core writer
// ---------------------------------------------------------------------------

/**
 * Log an audit event to D1 + R2. Fire-and-forget — never blocks, never throws.
 *
 * D1 and R2 writes are dispatched concurrently but NOT awaited, so callers
 * can safely `await audit(...)` or call without await — either way the
 * response is not delayed by audit I/O.
 *
 * @param db   D1 session handle (write session for the current request)
 * @param r2   R2 bucket for cold archive
 * @param entry Audit event details
 */
export function audit(db: DbHandle, r2: R2Bucket, entry: AuditEntry): void {
  const id = generateId();
  const ts = now();
  const detail = entry.detail ? JSON.stringify(entry.detail) : null;

  const row: AuditLogRow = {
    id,
    namespace_id: entry.namespace_id ?? null,
    email: entry.email,
    action: entry.action,
    resource_type: entry.resource_type ?? null,
    resource_id: entry.resource_id ?? null,
    detail,
    created_at: ts,
  };

  // Structured tail log — visible via `wrangler tail` in real-time.
  // Only structural metadata; no email, detail, or other sensitive data.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      audit: true,
      action: entry.action,
      namespace_id: entry.namespace_id ?? null,
      resource_type: entry.resource_type ?? null,
      resource_id: entry.resource_id ?? null,
      ts,
    }),
  );

  // Fire-and-forget — never block the caller's response.
  // Both writes settle independently; failures are silently swallowed.
  void Promise.allSettled([writeD1(db, row), appendR2(r2, row)]);
}

// ---------------------------------------------------------------------------
// D1 hot window
// ---------------------------------------------------------------------------

async function writeD1(db: DbHandle, row: AuditLogRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, namespace_id, email, action, resource_type, resource_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.namespace_id,
      row.email,
      row.action,
      row.resource_type,
      row.resource_id,
      row.detail,
      row.created_at,
    )
    .run();
}

// ---------------------------------------------------------------------------
// R2 NDJSON cold archive (Loki-compatible)
// ---------------------------------------------------------------------------

async function appendR2(r2: R2Bucket, row: AuditLogRow): Promise<void> {
  const isoDate = new Date(row.created_at * 1000).toISOString();
  const day = isoDate.slice(0, 10);
  const key = `audit/${day}.ndjson`;

  const line =
    JSON.stringify({
      timestamp: isoDate,
      id: row.id,
      namespace_id: row.namespace_id,
      email: row.email,
      action: row.action,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      detail: row.detail ? JSON.parse(row.detail) : null,
    }) + "\n";

  // R2 has no native append. Read existing + concat.
  const existing = await r2.get(key);
  const prev = existing ? await existing.text() : "";
  await r2.put(key, prev + line, {
    httpMetadata: { contentType: "application/x-ndjson" },
  });
}

// ---------------------------------------------------------------------------
// Query helpers (for MCP tool + REST API)
// ---------------------------------------------------------------------------

export interface AuditQuery {
  namespace_id?: string;
  email?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  since?: number;
  until?: number;
  limit?: number;
}

/** Query audit logs from D1 with optional filters. */
export async function queryAuditLogs(db: DbHandle, q: AuditQuery): Promise<AuditLogRow[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (q.namespace_id) {
    clauses.push("namespace_id = ?");
    binds.push(q.namespace_id);
  }
  if (q.email) {
    clauses.push("email = ?");
    binds.push(q.email);
  }
  if (q.action) {
    clauses.push("action = ?");
    binds.push(q.action);
  }
  if (q.resource_type) {
    clauses.push("resource_type = ?");
    binds.push(q.resource_type);
  }
  if (q.resource_id) {
    clauses.push("resource_id = ?");
    binds.push(q.resource_id);
  }
  if (q.since) {
    clauses.push("created_at >= ?");
    binds.push(q.since);
  }
  if (q.until) {
    clauses.push("created_at <= ?");
    binds.push(q.until);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(q.limit ?? 100, 500);
  binds.push(limit);

  const sql = `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`;
  const stmt = db.prepare(sql);
  const result = await stmt.bind(...binds).all<AuditLogRow>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Purge (used by consolidation workflow)
// ---------------------------------------------------------------------------

/** Delete audit logs older than a given epoch from D1. R2 archive is retained. */
export async function purgeAuditLogs(db: DbHandle, olderThanEpoch: number): Promise<number> {
  const result = await db
    .prepare("DELETE FROM audit_logs WHERE created_at < ?")
    .bind(olderThanEpoch)
    .run();
  return result.meta.changes ?? 0;
}
