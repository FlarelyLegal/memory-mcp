/** Single source of truth — reads version from package.json at build time. */
import pkg from "../package.json";

export const VERSION: string = pkg.version;
export const SERVER_NAME = "memory-graph-mcp";
export const SERVER_DISPLAY_NAME = "FlarelyLegal Memory MCP Server";
export const SERVER_DESCRIPTION =
  "Collaborative memory for LLMs — shared knowledge graphs with RBAC, semantic search, and temporally-decayed recall. Works solo or as the shared memory layer for teams and organizations.";
export const REPO_URL = "https://github.com/FlarelyLegal/memory-mcp";
