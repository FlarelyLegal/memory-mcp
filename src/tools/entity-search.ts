/** Tool registration: find_entities */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { typeFilter, queryField } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as graph from "../graph/index.js";
import { assertNamespaceReadAccess } from "../auth.js";
import { parseJson } from "../utils.js";
import { track, resolveNamespace } from "../state.js";
import { txt, err, cap, trunc, trackTools } from "../response-helpers.js";

export function registerEntitySearchTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "find_entities",
    "Search entities by name/type/keyword in a namespace.",
    {
      namespace_id: z.string().uuid().optional().describe("Defaults to last-used namespace"),
      query: queryField.optional(),
      type: typeFilter.optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Find Entities",
      readOnlyHint: true,
      openWorldHint: false,
    },
    tracked(
      "find_entities",
      async ({ namespace_id: nsParam, query, type, limit, compact, verbose }) => {
        const namespace_id = resolveNamespace(nsParam, agent);
        if (!namespace_id) return err("namespace_id required");
        const db = session(env.DB, "first-unconstrained");
        await assertNamespaceReadAccess(db, namespace_id, email);
        track(agent, { namespace: namespace_id });
        const results = await graph.searchEntities(db, namespace_id, {
          query,
          type,
          limit: cap(limit, 50, 20),
        });
        const isCompact = compact ?? true;
        const full = verbose ?? false;
        return txt(
          results.map((r) =>
            isCompact
              ? { id: r.id, name: r.name, type: r.type }
              : {
                  id: r.id,
                  name: r.name,
                  type: r.type,
                  summary: full ? r.summary : trunc(r.summary),
                  metadata: parseJson(r.metadata),
                },
          ),
        );
      },
    ),
  );
}
