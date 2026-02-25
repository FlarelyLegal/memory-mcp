/** Tool registration: manage_relation, get_relations */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as graph from "../graph/index.js";
import { assertNamespaceAccess, assertEntityAccess, assertRelationAccess } from "../auth.js";
import { txt, ok, cap } from "../response-helpers.js";

export function registerRelationTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_relation",
    "Create or delete a directed relation between entities.",
    {
      action: z.enum(["create", "delete"]),
      id: z.string().optional().describe("Required for delete"),
      namespace_id: z.string().optional().describe("Required for create"),
      source_id: z.string().optional().describe("From entity"),
      target_id: z.string().optional().describe("To entity"),
      relation_type: z.string().optional().describe("knows, uses, depends_on, part_of, etc."),
      weight: z.number().optional(),
      metadata: z.string().optional(),
    },
    async ({ action, id, namespace_id, source_id, target_id, relation_type, weight, metadata }) => {
      if (action === "create") {
        if (!namespace_id || !source_id || !target_id || !relation_type)
          return ok("Error: namespace_id, source_id, target_id, relation_type required");
        await assertNamespaceAccess(env.DB, namespace_id, email);
        const rid = await graph.createRelation(env.DB, {
          namespace_id,
          source_id,
          target_id,
          relation_type,
          weight,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        return txt({ id: rid, source_id, target_id, relation_type });
      }
      if (!id) return ok("Error: id required");
      await assertRelationAccess(env.DB, id, email);
      await graph.deleteRelation(env.DB, id);
      return ok(`Deleted ${id}`);
    },
  );

  server.tool(
    "get_relations",
    "Get relations from/to an entity.",
    {
      entity_id: z.string(),
      direction: z.enum(["from", "to", "both"]).optional(),
      relation_type: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ entity_id, direction, relation_type, limit }) => {
      await assertEntityAccess(env.DB, entity_id, email);
      const dir = direction ?? "both";
      const n = cap(limit, 50, 20);
      const results: unknown[] = [];
      if (dir === "from" || dir === "both") {
        const rels = await graph.getRelationsFrom(env.DB, entity_id, {
          relation_type,
          limit: n,
        });
        results.push(
          ...rels.map((r) => ({
            id: r.id,
            target_id: r.target_id,
            type: r.relation_type,
            weight: r.weight,
          })),
        );
      }
      if (dir === "to" || dir === "both") {
        const rels = await graph.getRelationsTo(env.DB, entity_id, {
          relation_type,
          limit: n,
        });
        results.push(
          ...rels.map((r) => ({
            id: r.id,
            source_id: r.source_id,
            type: r.relation_type,
            weight: r.weight,
          })),
        );
      }
      return txt(results);
    },
  );
}
