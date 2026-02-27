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

// ---------------------------------------------------------------------------
// D1 write retry with jitter backoff
// ---------------------------------------------------------------------------
// Adapted from @cloudflare/actors tryWhile pattern.
// D1 does NOT auto-retry writes (only reads get up to 2 retries).
// These transient errors are safe to retry:

const MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const BASE_DELAY_MS = 100;
const MAX_DELAY_MS = 2000;

function isD1Retryable(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("Network connection lost") ||
    msg.includes("storage caused object to be reset") ||
    msg.includes("reset because its code was updated") ||
    msg.includes("Cannot resolve D1 DB due to transient issue")
  );
}

function jitterBackoff(attempt: number): number {
  const upper = Math.min(2 ** attempt * BASE_DELAY_MS, MAX_DELAY_MS);
  return Math.floor(Math.random() * upper);
}

/** Detects duplicate-key style errors emitted by SQLite/D1 writes. */
function isDuplicateKeyError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("unique constraint failed") ||
    msg.includes("primary key") ||
    msg.includes("constraint failed")
  );
}

/**
 * Retry a D1 write operation on transient errors.
 * Wraps a single `.run()` or `.batch()` call with exponential jitter backoff.
 * Non-retryable errors are thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > MAX_ATTEMPTS || !isD1Retryable(err)) throw err;
      // eslint-disable-next-line no-console
      console.warn(`D1 retry ${attempt - 1}/${MAX_ATTEMPTS - 1}: ${String(err).slice(0, 120)}`);
      await new Promise((resolve) => setTimeout(resolve, jitterBackoff(attempt)));
    }
  }
}

/**
 * Detect likely "write succeeded but retry replayed" conflicts.
 *
 * If a write operation throws a duplicate-key error after retries, we verify whether
 * the row with the intended ID already exists. When it does, treat it as a replayed
 * success instead of surfacing a false failure to callers.
 */
export async function isReplayInsertConflict(
  db: DbHandle,
  table: string,
  id: string,
  err: unknown,
): Promise<boolean> {
  if (!isDuplicateKeyError(err)) return false;
  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ id: string }>();
  return Boolean(row);
}
