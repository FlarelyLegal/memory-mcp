/**
 * Grant and group membership expiry: data-layer cleanup functions.
 *
 * Transitions rows from status='active' to status='expired' when their
 * `expires_at` timestamp has passed. Returns affected emails so callers
 * can bust identity caches.
 *
 * These are idempotent -- re-running on already-expired rows is a no-op
 * because the WHERE clause requires `status = 'active'`.
 */
import type { DbHandle } from "./db.js";
import { now } from "./utils.js";

export interface ExpiryResult {
  /** Number of rows transitioned to 'expired'. */
  expired: number;
  /** Unique emails whose identity cache should be busted. */
  affected_emails: string[];
}

/**
 * Transition namespace grants past their `expires_at` to status='expired'.
 * Returns count and affected emails (direct grantees + group members).
 */
export async function expireGrants(db: DbHandle): Promise<ExpiryResult> {
  const ts = now();

  // Find grants to expire and collect affected emails
  const candidates = await db
    .prepare(
      `SELECT id, email, group_id FROM namespace_grants
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .bind(ts)
    .all<{ id: string; email: string | null; group_id: string | null }>();

  if (candidates.results.length === 0) return { expired: 0, affected_emails: [] };

  // Collect directly affected emails
  const emails = new Set<string>();
  const groupIds = new Set<string>();
  for (const row of candidates.results) {
    if (row.email) emails.add(row.email.toLowerCase());
    if (row.group_id) groupIds.add(row.group_id);
  }

  // Resolve group members for group-based grants
  if (groupIds.size > 0) {
    const placeholders = Array.from(groupIds)
      .map(() => "?")
      .join(", ");
    const members = await db
      .prepare(
        `SELECT DISTINCT email FROM group_members
         WHERE group_id IN (${placeholders}) AND status = 'active'`,
      )
      .bind(...groupIds)
      .all<{ email: string }>();
    for (const m of members.results) {
      emails.add(m.email.toLowerCase());
    }
  }

  // Batch-expire all candidate grants
  const stmt = db.prepare(
    `UPDATE namespace_grants
     SET status = 'expired', updated_at = ?
     WHERE id = ? AND status = 'active'`,
  );
  const results = await db.batch(candidates.results.map((r) => stmt.bind(ts, r.id)));
  const expired = results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);

  return { expired, affected_emails: Array.from(emails) };
}

/**
 * Transition group memberships past their `expires_at` to status='expired'.
 * Returns count and affected emails.
 */
export async function expireGroupMembers(db: DbHandle): Promise<ExpiryResult> {
  const ts = now();

  const candidates = await db
    .prepare(
      `SELECT id, email FROM group_members
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .bind(ts)
    .all<{ id: string; email: string }>();

  if (candidates.results.length === 0) return { expired: 0, affected_emails: [] };

  const emails = new Set(candidates.results.map((r) => r.email.toLowerCase()));

  const stmt = db.prepare(
    `UPDATE group_members
     SET status = 'expired', updated_at = ?
     WHERE id = ? AND status = 'active'`,
  );
  const results = await db.batch(candidates.results.map((r) => stmt.bind(ts, r.id)));
  const expired = results.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);

  return { expired, affected_emails: Array.from(emails) };
}
