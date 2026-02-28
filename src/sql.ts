/**
 * Shared SQL predicates and fragments.
 *
 * Centralizes reusable WHERE-clause predicates so query files don't
 * duplicate raw SQL strings. If the predicate logic changes (e.g. a
 * new status or time function), there is one place to update.
 */

/**
 * Filters out rows whose `expires_at` has passed.
 * Append with `AND` to any query that already filters `status = 'active'`.
 * Uses D1's `unixepoch()` for server-side time comparison.
 *
 * Rows with `expires_at IS NULL` are treated as never-expiring.
 */
export const NOT_EXPIRED = "(expires_at IS NULL OR expires_at > unixepoch())";
