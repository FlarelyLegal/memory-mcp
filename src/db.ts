/**
 * D1 Sessions API helpers for read replication.
 *
 * D1 read replication routes queries to the nearest replica. Sessions provide
 * sequential consistency: all queries within a session see prior writes.
 *
 * - `"first-primary"`: first query goes to primary (for write-then-read flows).
 * - `"first-unconstrained"`: first query may hit any replica (lowest latency).
 * - Bookmark string: anchors session to a specific point-in-time.
 *
 * All data-layer functions accept `DbHandle` — the shared subset of
 * `D1Database` and `D1DatabaseSession` (prepare + batch).
 */

/**
 * Shared interface for both D1Database and D1DatabaseSession.
 * Both provide prepare() and batch() — the only methods our data layer uses.
 */
export type DbHandle = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

/**
 * Create a D1 session for read replication.
 *
 * @param db - The raw D1Database binding
 * @param mode - Session constraint or a bookmark string from a prior session
 * @returns A D1DatabaseSession with prepare(), batch(), and getBookmark()
 */
export function session(
  db: D1Database,
  mode: D1SessionConstraint | D1SessionBookmark = "first-unconstrained",
): D1DatabaseSession {
  return db.withSession(mode);
}

/**
 * Extract the bookmark from a DbHandle if it's a session.
 * Returns null for raw D1Database (no session) or sessions with no queries yet.
 */
export function getBookmark(db: DbHandle): string | null {
  if ("getBookmark" in db && typeof db.getBookmark === "function") {
    return (db as D1DatabaseSession).getBookmark();
  }
  return null;
}
