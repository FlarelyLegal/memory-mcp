/** Lightweight audit event writer for security-sensitive API actions. */
import type { Env } from "../types.js";

export interface AuditEvent {
  action: string;
  actor_type: "human" | "service_token";
  email?: string | null;
  common_name?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(env: Env, event: AuditEvent): Promise<void> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const key = `audit/${day}/${now.toISOString()}-${crypto.randomUUID()}.json`;
  const payload = {
    timestamp: now.toISOString(),
    ...event,
  };

  // Best-effort audit write; never break request flow.
  try {
    await env.STORAGE.put(key, JSON.stringify(payload), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    // Best-effort only.
  }
}
