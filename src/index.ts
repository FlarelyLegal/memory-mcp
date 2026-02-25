/**
 * Memory Graph MCP Server
 *
 * A remote MCP server deployed on Cloudflare Workers that provides LLMs
 * with persistent, structured memory: entity graphs, semantic search,
 * conversation history, and temporally-decayed recall.
 *
 * Uses McpAgent (Durable Objects) so each session gets its own stateful
 * instance with direct access to env bindings.
 *
 * Secured with Cloudflare Access via OAuthProvider.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Env, AuthProps } from "./types.js";
import { VERSION } from "./version.js";
import { handleAccessRequest } from "./access-handler.js";

// Tool registration modules
import { registerNamespaceTools } from "./tools/namespace.js";
import { registerEntityTools } from "./tools/entity.js";
import { registerRelationTools } from "./tools/relation.js";
import { registerTraversalTools } from "./tools/traversal.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerConversationTools } from "./tools/conversation.js";
import { registerSearchTools } from "./tools/search.js";
import { registerAdminTools } from "./tools/admin.js";

export class MemoryGraphMCP extends McpAgent<Env, Record<string, never>, AuthProps> {
  server = new McpServer({
    name: "Memory Graph",
    version: VERSION,
  });

  /** Get the authenticated user's email, or throw. */
  private get email(): string {
    const e = this.props?.email;
    if (!e) throw new Error("Not authenticated");
    return e;
  }

  async init() {
    registerNamespaceTools(this.server, this.env, this.email);
    registerEntityTools(this.server, this.env, this.email);
    registerRelationTools(this.server, this.env, this.email);
    registerTraversalTools(this.server, this.env, this.email);
    registerMemoryTools(this.server, this.env, this.email);
    registerConversationTools(this.server, this.env, this.email);
    registerSearchTools(this.server, this.env, this.email);
    registerAdminTools(this.server, this.env, this.email);
  }
}

// Wrap MCP with OAuthProvider for Cloudflare Access authentication.
// The /health endpoint is handled inside the defaultHandler (access-handler.ts).
export default new OAuthProvider({
  apiHandler: MemoryGraphMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: { fetch: handleAccessRequest as unknown as ExportedHandlerFetchHandler },
  tokenEndpoint: "/token",
});
