/**
 * Structured logging helpers for consistent, parseable JSON output.
 *
 * All console output should use these helpers so `wrangler tail --format json`
 * can parse every log line. Each log has a top-level type flag for filtering:
 *
 * - `{ "error": true, ... }` for errors
 * - `{ "warn": true, ... }` for warnings
 *
 * Audit logs use their own `{ "audit": true, ... }` format in `src/audit.ts`.
 *
 * PII policy: email is deliberately excluded from all console output.
 * Use the audit correlation `id` to look up the full record in D1/R2.
 */

interface LogContext {
  source: "tool" | "api" | "oauth" | "db" | "fts" | "audit";
  tool?: string;
  route?: string;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function extractStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack;
  return undefined;
}

/**
 * Emit a structured error log. Visible via `wrangler tail`.
 * No PII (email) included -- use audit `id` for correlation.
 */
export function logError(context: LogContext, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      error: true,
      source: context.source,
      ...(context.tool && { tool: context.tool }),
      ...(context.route && { route: context.route }),
      message: extractMessage(err),
      ...(extractStack(err) && { stack: extractStack(err) }),
    }),
  );
}

/**
 * Emit a structured warning log. Visible via `wrangler tail`.
 * No PII (email) included.
 */
export function logWarn(
  context: LogContext,
  message: string,
  extra?: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      warn: true,
      source: context.source,
      ...(context.tool && { tool: context.tool }),
      ...(context.route && { route: context.route }),
      message,
      ...extra,
    }),
  );
}
