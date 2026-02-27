/**
 * API-layer audit helper for service token events.
 *
 * Wraps the unified audit module (src/audit.ts) with the legacy
 * `writeAuditEvent` signature used by token route handlers.
 */
import type { Env } from "../types.js";
import { audit, type AuditAction } from "../audit.js";
import { session } from "../db.js";

export interface AuditEvent {
  action: string;
  actor_type: "human" | "service_token";
  email?: string | null;
  common_name?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Map legacy action strings to typed AuditAction values. */
function mapAction(action: string): AuditAction {
  const map: Record<string, AuditAction> = {
    service_token_bind_request_created: "service_token.bind_request",
    service_token_bind_request_conflict: "service_token.bind_conflict",
    service_token_bind_self_denied: "service_token.bind_denied",
    service_token_bind_self_conflict: "service_token.bind_conflict",
    service_token_bound: "service_token.bind_self",
    service_token_updated: "service_token.update",
    service_token_revoked: "service_token.revoke",
  };
  const mapped = map[action];
  if (!mapped) {
    // eslint-disable-next-line no-console
    console.warn(`audit: unknown legacy action "${action}", logging as-is`);
    return action as AuditAction;
  }
  return mapped;
}

export async function writeAuditEvent(env: Env, event: AuditEvent): Promise<void> {
  const db = session(env.DB, "first-primary");
  await audit(db, env.STORAGE, {
    action: mapAction(event.action),
    email: event.email ?? "unknown",
    resource_type: "service_token",
    resource_id: event.common_name ?? null,
    detail: {
      actor_type: event.actor_type,
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.metadata ?? {}),
    },
  });
}
