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

import type { Env, AuthProps, SessionState } from "./types.js";
import { VERSION, SERVER_DISPLAY_NAME, SERVER_DESCRIPTION } from "./version.js";
import { handleAccessRequest } from "./access-handler.js";

// Tool registration modules
import { registerNamespaceTools } from "./tools/namespace.js";
import { registerEntityTools } from "./tools/entity.js";
import { registerEntitySearchTools } from "./tools/entity-search.js";
import { registerRelationTools } from "./tools/relation.js";
import { registerTraversalTools } from "./tools/traversal.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerMemoryQueryTools } from "./tools/memory-queries.js";
import { registerConversationTools } from "./tools/conversation.js";
import { registerMessageTools } from "./tools/message.js";
import { registerSearchTools } from "./tools/search.js";
import { registerAdminTools } from "./tools/admin.js";

// Workflow exports (Wrangler resolves class_name from these re-exports)
export { ReindexWorkflow } from "./workflows/reindex.js";
export { ConsolidationWorkflow } from "./workflows/consolidation.js";

/** Idle session timeout: 24 hours in seconds. */
const SESSION_IDLE_TIMEOUT_S = 24 * 60 * 60;
const EXPIRY_SCHEDULE_TYPE = "delayed" as const;

export class MemoryGraphMCP extends McpAgent<Env, SessionState, AuthProps> {
  server = new McpServer({
    name: SERVER_DISPLAY_NAME,
    version: VERSION,
    description: SERVER_DESCRIPTION,
  });

  initialState: SessionState = { recentEntities: [] };

  /** Get the authenticated user's email, or throw. */
  private get email(): string {
    const e = this.props?.email;
    if (!e) throw new Error("Not authenticated");
    return e;
  }

  /**
   * Called every time the DO wakes up for a new connection.
   * Resets the idle expiry timer so inactive sessions are cleaned up.
   */
  async onStart(props?: AuthProps) {
    await super.onStart(props);
    await this.resetIdleTimer();
  }

  /** Cancel any existing expiry schedule and set a fresh one. */
  private async resetIdleTimer() {
    // Cancel all prior expiry schedules
    const existing = this.getSchedules({ type: EXPIRY_SCHEDULE_TYPE });
    for (const s of existing) {
      await this.cancelSchedule(s.id);
    }
    // Schedule cleanup after idle timeout
    await this.schedule(SESSION_IDLE_TIMEOUT_S, "expireSession");
  }

  /** Called by the scheduler when idle timeout fires. Destroys all DO state. */
  async expireSession() {
    await this.destroy();
  }

  async init() {
    registerNamespaceTools(this.server, this.env, this.email, this);
    registerEntityTools(this.server, this.env, this.email, this);
    registerEntitySearchTools(this.server, this.env, this.email, this);
    registerRelationTools(this.server, this.env, this.email, this);
    registerTraversalTools(this.server, this.env, this.email, this);
    registerMemoryTools(this.server, this.env, this.email, this);
    registerMemoryQueryTools(this.server, this.env, this.email, this);
    registerConversationTools(this.server, this.env, this.email, this);
    registerMessageTools(this.server, this.env, this.email, this);
    registerSearchTools(this.server, this.env, this.email, this);
    registerAdminTools(this.server, this.env, this.email, this);
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
