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
      name: z.string().max(200).optional().describe("Required for create"),
      description: z.string().max(2000).optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
    },
    async ({ action, name, description, compact }) => {
      if (action === "create") {
        if (!name) return ok("Error: name required");
        const id = await graph.createNamespace(env.DB, {
          name,
          description,
          owner: email,
        });
        return txt({ id, name });
      }
      const isCompact = compact ?? true;
      const rows = await graph.listNamespaces(env.DB, email);
      return txt(
        rows.map((r) =>
          isCompact
            ? { id: r.id, name: r.name }
            : { id: r.id, name: r.name, description: r.description },
        ),
      );
    },
  );
}
