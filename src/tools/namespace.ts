/** Tool registration: manage_namespace */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as graph from "../graph/index.js";
import { txt, ok } from "../response-helpers.js";

export function registerNamespaceTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_namespace",
    "Create or list memory namespaces (scopes for organizing data).",
    {
      action: z.enum(["create", "list"]),
      name: z.string().optional().describe("Required for create"),
      description: z.string().optional(),
    },
    async ({ action, name, description }) => {
      if (action === "create") {
        if (!name) return ok("Error: name required");
        const id = await graph.createNamespace(env.DB, {
          name,
          description,
          owner: email,
        });
        return txt({ id, name });
      }
      return txt(await graph.listNamespaces(env.DB, email));
    },
  );
}
