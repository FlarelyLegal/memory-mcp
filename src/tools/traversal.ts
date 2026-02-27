/** Tool registration: traverse_graph */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as graph from "../graph/index.js";
import { assertEntityReadAccess } from "../auth.js";
import { track } from "../state.js";
import { txt, toolHandler } from "../response-helpers.js";

export function registerTraversalTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
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
      const db = session(env.DB, "first-unconstrained");
      await assertEntityReadAccess(db, entity_id, email);
      track(agent, { entity: entity_id });
      return txt(
        await graph.traverse(db, entity_id, {
          maxDepth: Math.min(max_depth ?? 2, 5),
          relationTypes: relation_types,
        }),
      );
    }),
  );
}
