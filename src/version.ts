/** Single source of truth — reads version from package.json at build time. */
import pkg from "../package.json";

export const VERSION: string = pkg.version;
export const SERVER_NAME = "memory-graph-mcp";
