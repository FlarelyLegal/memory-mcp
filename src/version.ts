/** Single source of truth — reads version from package.json at build time. */
import pkg from "../package.json";

export const VERSION: string = pkg.version;
export const SERVER_NAME = "memory-graph-mcp";
export const SERVER_DISPLAY_NAME = "Memory Graph MCP";
export const SERVER_DESCRIPTION =
  "Persistent structured memory for LLMs — knowledge graphs, semantic search, and temporally-decayed recall.";
export const REPO_URL = "https://github.com/FlarelyLegal/memory-mcp";
