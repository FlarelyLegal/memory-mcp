/** Single source of truth -- reads version from package.json at build time. */
import pkg from "../package.json";

export const VERSION: string = pkg.version;
export const SERVER_NAME = "memory-graph-mcp";
export const SERVER_DISPLAY_NAME = "FlarelyLegal Memory MCP Server";
export const SERVER_DESCRIPTION =
  "Remote MCP server providing LLMs with persistent shared memory: knowledge graphs, semantic search, RBAC namespace sharing, and temporally-decayed recall. Built on Cloudflare Workers.";
export const REPO_URL = "https://github.com/FlarelyLegal/memory-mcp";
