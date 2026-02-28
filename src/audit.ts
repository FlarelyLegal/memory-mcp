/**
 * Audit logging — D1 hot window + R2 cold archive.
 *
 * All write operations are audit-logged via `audit()`. Each call:
 * 1. Inserts a row into the D1 `audit_logs` table (queryable hot window).
 * 2. Writes an individual JSON object to R2 at `audit/events/{day}/{id}.json`.
 *
 * Both writes are fire-and-forget — failures never block the request flow.
 *
 * The consolidation workflow merges individual R2 event objects into daily
 * NDJSON files (`audit/{YYYY-MM-DD}.ndjson`) via `consolidateAuditR2()`.
 * This eliminates the read-modify-write race condition of direct append.
 */
import type { DbHandle } from "./db.js";
import type { AuditEntry } from "./audit-types.js";
import type { AuditLogRow } from "./types.js";
import { generateId, now } from "./utils.js";

export type { AuditAction, ResourceType, AuditEntry } from "./audit-types.js";

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
  void Promise.allSettled([writeD1(db, row), writeR2(r2, row)]);
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
// R2 cold archive — individual event objects (race-free)
// ---------------------------------------------------------------------------

/** Write a single audit event as its own R2 object. No read-modify-write. */
async function writeR2(r2: R2Bucket, row: AuditLogRow): Promise<void> {
  const isoDate = new Date(row.created_at * 1000).toISOString();
  const key = `audit/events/${isoDate.slice(0, 10)}/${row.id}.json`;
  await r2.put(key, rowToJson(row, isoDate), {
    httpMetadata: { contentType: "application/json" },
  });
}

function rowToJson(row: AuditLogRow, isoDate: string): string {
  return JSON.stringify({
    timestamp: isoDate,
    id: row.id,
    namespace_id: row.namespace_id,
    email: row.email,
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    detail: row.detail ? JSON.parse(row.detail) : null,
  });
}

/**
 * Merge individual R2 audit event objects into a daily NDJSON file.
 * Called by the consolidation workflow (single-writer, no race).
 */
export async function consolidateAuditR2(r2: R2Bucket, day: string): Promise<number> {
  const prefix = `audit/events/${day}/`;
  const ndjsonKey = `audit/${day}.ndjson`;
  let cursor: string | undefined;
  const keys: string[] = [];
  const lines: string[] = [];

  do {
    const list = await r2.list({ prefix, cursor });
    for (const obj of list.objects) {
      keys.push(obj.key);
      const data = await r2.get(obj.key);
      if (data) lines.push((await data.text()).trim());
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  if (lines.length === 0) return 0;

  // Append to existing daily NDJSON (or create new)
  const existing = await r2.get(ndjsonKey);
  const prev = existing ? await existing.text() : "";
  await r2.put(ndjsonKey, prev + lines.join("\n") + "\n", {
    httpMetadata: { contentType: "application/x-ndjson" },
  });

  // Delete individual objects after successful merge
  for (const key of keys) {
    try {
      await r2.delete(key);
    } catch {
      /* best-effort */
    }
  }
  return lines.length;
}

// ---------------------------------------------------------------------------
// Query + purge helpers
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
  const push = (col: string, val: unknown) => {
    clauses.push(`${col} = ?`);
    binds.push(val);
  };
  if (q.namespace_id) push("namespace_id", q.namespace_id);
  if (q.email) push("email", q.email);
  if (q.action) push("action", q.action);
  if (q.resource_type) push("resource_type", q.resource_type);
  if (q.resource_id) push("resource_id", q.resource_id);
  if (q.since) {
    clauses.push("created_at >= ?");
    binds.push(q.since);
  }
  if (q.until) {
    clauses.push("created_at <= ?");
    binds.push(q.until);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  binds.push(Math.min(q.limit ?? 100, 500));
  const result = await db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...binds)
    .all<AuditLogRow>();
  return result.results;
}

/** Delete audit logs older than a given epoch from D1. R2 archive is retained. */
export async function purgeAuditLogs(db: DbHandle, olderThanEpoch: number): Promise<number> {
  const r = await db
    .prepare("DELETE FROM audit_logs WHERE created_at < ?")
    .bind(olderThanEpoch)
    .run();
  return r.meta.changes ?? 0;
}
