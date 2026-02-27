/** Tool registration: manage_relation, get_relations */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as graph from "../graph/index.js";
import { assertNamespaceAccess, assertEntityAccess, assertRelationAccess } from "../auth.js";
import { parseJson } from "../utils.js";
import { txt, ok, cap } from "../response-helpers.js";

export function registerRelationTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_relation",
    "Create or delete a directed relation between entities.",
    {
      action: z.enum(["create", "delete"]),
      id: z.string().uuid().optional().describe("Required for delete"),
      namespace_id: z.string().uuid().optional().describe("Required for create"),
      source_id: z.string().uuid().optional().describe("From entity"),
      target_id: z.string().uuid().optional().describe("To entity"),
      relation_type: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("knows, uses, depends_on, part_of, etc."),
      weight: z.number().min(0).max(1).optional(),
      metadata: z.string().max(5000).optional(),
    },
    {
      title: "Manage Relation",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ action, id, namespace_id, source_id, target_id, relation_type, weight, metadata }) => {
      if (action === "create") {
        if (!namespace_id || !source_id || !target_id || !relation_type)
          return ok("Error: namespace_id, source_id, target_id, relation_type required");
        await assertNamespaceAccess(env.DB, namespace_id, email);
        // Verify both entities exist and belong to this namespace.
        const srcNs = await assertEntityAccess(env.DB, source_id, email);
        const tgtNs = await assertEntityAccess(env.DB, target_id, email);
        if (srcNs !== namespace_id || tgtNs !== namespace_id)
          return ok("Error: source and target entities must belong to the specified namespace");
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
      entity_id: z.string().uuid(),
      direction: z.enum(["from", "to", "both"]).optional(),
      relation_type: z.string().max(200).optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
    },
    {
      title: "Get Relations",
      readOnlyHint: true,
      openWorldHint: false,
    },
    async ({ entity_id, direction, relation_type, limit, compact }) => {
      await assertEntityAccess(env.DB, entity_id, email);
      const dir = direction ?? "both";
      const n = cap(limit, 50, 20);
      const isCompact = compact ?? true;
      const mapRel = (r: {
        id: string;
        source_id: string;
        target_id: string;
        relation_type: string;
        weight: number;
        metadata: string | null;
      }) =>
        isCompact
          ? {
              id: r.id,
              source_id: r.source_id,
              target_id: r.target_id,
              relation_type: r.relation_type,
              weight: r.weight,
            }
          : {
              id: r.id,
              source_id: r.source_id,
              target_id: r.target_id,
              relation_type: r.relation_type,
              weight: r.weight,
              metadata: parseJson(r.metadata),
            };
      const results: unknown[] = [];
      if (dir === "from" || dir === "both") {
        const rels = await graph.getRelationsFrom(env.DB, entity_id, {
          relation_type,
          limit: n,
        });
        results.push(...rels.map(mapRel));
      }
      if (dir === "to" || dir === "both") {
        const rels = await graph.getRelationsTo(env.DB, entity_id, {
          relation_type,
          limit: n,
        });
        results.push(...rels.map(mapRel));
      }
      return txt(results);
    },
  );
}
