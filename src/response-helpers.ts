/** Shared response helpers for MCP tool handlers. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "./types.js";
import { AccessDeniedError } from "./auth.js";
import { trackEvent } from "./analytics.js";

/** Tool result type matching MCP SDK CallToolResult. */
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Success: return structured JSON data. */
export function txt(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/** Success: return a plain text message. */
export function ok(msg: string): ToolResult {
  return { content: [{ type: "text" as const, text: msg }] };
}

/** Error: return a plain text message with isError: true. */
export function err(msg: string): ToolResult {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

/** Safely parse a JSON metadata string. Returns err() result on bad input. */
export function safeMeta(raw: string | undefined): Record<string, unknown> | ToolResult {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return err("Invalid JSON in metadata field");
  }
}

/** Check if safeMeta returned an error. */
export function isMetaError(v: Record<string, unknown> | ToolResult): v is ToolResult {
  return "isError" in v && v.isError === true;
}

/** Analytics context for MCP tool tracking. */
export interface ToolAnalytics {
  env: Env;
  email: string;
  tool: string;
}

/**
 * Wrap a tool handler with centralized error handling and analytics tracking.
 * Catches AccessDeniedError → err(), unknown errors → err() with generic message.
 * Tracks every invocation to Analytics Engine (fire-and-forget).
 */
export function toolHandler<T>(
  analytics: ToolAnalytics,
  fn: (args: T) => Promise<ToolResult>,
): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    const start = Date.now();
    try {
      const result = await fn(args);
      trackEvent(analytics.env, {
        channel: "mcp",
        tool: analytics.tool,
        status: result.isError ? "error" : "ok",
        email: analytics.email,
        latencyMs: Date.now() - start,
      });
      return result;
    } catch (e) {
      trackEvent(analytics.env, {
        channel: "mcp",
        tool: analytics.tool,
        status: "error",
        email: analytics.email,
        latencyMs: Date.now() - start,
      });
      if (e instanceof AccessDeniedError) {
        return err(e.message);
      }
      // eslint-disable-next-line no-console
      console.error("Tool error:", e);
      return err("Internal error — please try again");
    }
  };
}

/**
 * Create a scoped tool handler factory with analytics pre-bound.
 * Use in register*Tools functions: `const tracked = trackTools(env, email);`
 * then `tracked("tool_name", async (args) => { ... })`.
 */
export function trackTools(env: Env, email: string) {
  return <T>(tool: string, fn: (args: T) => Promise<ToolResult>) =>
    toolHandler({ env, email, tool }, fn);
}

/**
 * Ask the user for confirmation before a destructive operation.
 * Gracefully degrades: if the client doesn't support elicitation, returns true.
 * Returns true if confirmed (or unsupported), false if declined/cancelled.
 */
export async function confirm(server: McpServer, message: string): Promise<boolean> {
  const caps = server.server.getClientCapabilities();
  if (!caps?.elicitation?.form) return true;
  const result = await server.server.elicitInput({
    message,
    requestedSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          title: "Confirm",
          description: "Proceed with this operation?",
          default: false,
        },
      },
      required: ["confirm"],
    },
  });
  return result.action === "accept" && result.content?.confirm === true;
}

export function cap(n: number | undefined, max: number, def: number) {
  return Math.min(n ?? def, max);
}

export function trunc(value: string | null | undefined, max = 400): string | null | undefined {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}
