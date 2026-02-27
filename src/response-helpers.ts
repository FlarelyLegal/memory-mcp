/** Shared response helpers for MCP tool handlers. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AccessDeniedError } from "./auth.js";

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

/**
 * Wrap a tool handler with centralized error handling.
 * Catches AccessDeniedError → err(), unknown errors → err() with generic message.
 */
export function toolHandler<T>(
  fn: (args: T) => Promise<ToolResult>,
): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    try {
      return await fn(args);
    } catch (e) {
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
