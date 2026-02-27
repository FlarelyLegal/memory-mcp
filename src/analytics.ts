/**
 * Analytics Engine helpers.
 *
 * Writes structured data points to the `ANALYTICS` dataset for request-level
 * metrics on both REST API and MCP tool calls. Fire-and-forget ��� never blocks
 * the request. Gracefully no-ops when the binding is absent.
 *
 * Data point schema:
 *   index   — user email (sampling key for per-user queries)
 *   blob1   — channel: "api" | "mcp"
 *   blob2   — operation: route path or tool name
 *   blob3   — status: "ok" | "error"
 *   blob4   — detail: HTTP method (api) or action (mcp, if available)
 *   blob5   — namespace_id (when available)
 *   double1 — latency in ms
 *   double2 — response size in bytes (api) or 0 (mcp)
 */
import type { Env } from "./types.js";

interface ApiEvent {
  channel: "api";
  method: string;
  path: string;
  status: "ok" | "error";
  email: string;
  latencyMs: number;
  responseBytes?: number;
  namespaceId?: string;
}

interface McpEvent {
  channel: "mcp";
  tool: string;
  action?: string;
  status: "ok" | "error";
  email: string;
  latencyMs: number;
  namespaceId?: string;
}

export type AnalyticsEvent = ApiEvent | McpEvent;

/** Write an analytics data point. No-ops if binding is absent. Never throws. */
export function trackEvent(env: Env, event: AnalyticsEvent): void {
  if (!env.ANALYTICS) return;
  try {
    const operation = event.channel === "api" ? event.path : event.tool;
    const detail = event.channel === "api" ? event.method : (event.action ?? "");
    const responseBytes = event.channel === "api" ? (event.responseBytes ?? 0) : 0;

    env.ANALYTICS.writeDataPoint({
      indexes: [event.email],
      blobs: [event.channel, operation, event.status, detail, event.namespaceId ?? ""],
      doubles: [event.latencyMs, responseBytes],
    });
  } catch {
    // Fire-and-forget — never block the request.
  }
}
