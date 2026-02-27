/** Tool registration: traverse_graph */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as graph from "../graph/index.js";
import { assertEntityAccess } from "../auth.js";
import { txt, toolHandler } from "../response-helpers.js";

export function registerTraversalTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "traverse_graph",
    "BFS from an entity. Returns reachable entities and relations up to max_depth hops.",
    {
      entity_id: z.string().uuid(),
      max_depth: z.number().optional(),
      relation_types: z.array(z.string().max(200)).max(20).optional(),
    },
    {
      title: "Traverse Graph",
      readOnlyHint: true,
      openWorldHint: false,
    },
    toolHandler(async ({ entity_id, max_depth, relation_types }) => {
      await assertEntityAccess(env.DB, entity_id, email);
      return txt(
        await graph.traverse(env.DB, entity_id, {
          maxDepth: Math.min(max_depth ?? 2, 5),
          relationTypes: relation_types,
        }),
      );
    }),
  );
}
