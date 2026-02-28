/** Tool registration: traverse_graph */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { typeFilter } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import { loadIdentity } from "../identity.js";
import * as graph from "../graph/index.js";
import { assertEntityReadAccess } from "../auth.js";
import { track } from "../state.js";
import { txt, trackTools } from "../response-helpers.js";

export function registerTraversalTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "traverse_graph",
    "BFS from an entity. Returns reachable entities and relations up to max_depth hops.",
    {
      entity_id: z.string().uuid(),
      max_depth: z.number().optional(),
      relation_types: z.array(typeFilter).max(20).optional(),
    },
    {
      title: "Traverse Graph",
      readOnlyHint: true,
      openWorldHint: false,
    },
    tracked("traverse_graph", async ({ entity_id, max_depth, relation_types }) => {
      const db = session(env.DB, "first-unconstrained");
      const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
      await assertEntityReadAccess(db, entity_id, identity);
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
