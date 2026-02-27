/** Tool registration: search (semantic + context) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as graph from "../graph/index.js";
import * as memories from "../memories.js";
import * as vectorize from "../vectorize.js";
import { assertNamespaceAccess } from "../auth.js";
import { txt, cap, trunc, toolHandler } from "../response-helpers.js";

export function registerSearchTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "search",
    "Semantic vector search across all memory types. Use mode=context to also pull graph relations and ranked memories for matched entities.",
    {
      namespace_id: z.string().uuid(),
      query: z.string().min(1).max(1000),
      mode: z.enum(["semantic", "context"]).optional().describe("Default: semantic"),
      kind: z.enum(["entity", "memory", "message"]).optional().describe("Filter by kind"),
      type: z
        .string()
        .max(200)
        .optional()
        .describe("Filter by entity type or memory type (e.g. person, fact)"),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Search",
      readOnlyHint: true,
      openWorldHint: false,
    },
    toolHandler(async ({ namespace_id, query, mode, kind, type, limit, compact, verbose }) => {
      await assertNamespaceAccess(env.DB, namespace_id, email);
      const n = cap(limit, 20, mode === "context" ? 5 : 10);
      const isCompact = compact ?? true;
      const full = verbose ?? false;
      const semanticResults = await vectorize.semanticSearch(env, query, namespace_id, {
        kind,
        type,
        limit: n,
      });

      const mapMatch = (r: (typeof semanticResults)[number]) => ({
        id: r.id,
        name: typeof r.metadata?.name === "string" ? r.metadata.name : undefined,
        kind: r.kind,
        score: r.score,
        ...(isCompact ? {} : { metadata: r.metadata }),
      });

      if ((mode ?? "semantic") === "semantic") {
        return txt({ matches: semanticResults.map(mapMatch) });
      }

      // Context mode: enrich entity matches with graph + memories (parallel)
      const entityContext = await Promise.all(
        semanticResults
          .filter((r) => r.kind === "entity" && r.metadata.entity_id)
          .map(async (result) => {
            const eid = result.metadata.entity_id;
            const [entity, outRels, inRels, entityMems] = await Promise.all([
              graph.getEntity(env.DB, eid),
              graph.getRelationsFrom(env.DB, eid, { limit: 5 }),
              graph.getRelationsTo(env.DB, eid, { limit: 5 }),
              memories.getMemoriesForEntity(env.DB, eid, { limit: 5 }),
            ]);
            return {
              entity: entity
                ? {
                    id: entity.id,
                    name: entity.name,
                    type: entity.type,
                    ...(isCompact
                      ? {}
                      : { summary: full ? entity.summary : trunc(entity.summary) }),
                  }
                : null,
              relations: [
                ...outRels.map((r) => ({
                  id: r.id,
                  target_id: r.target_id,
                  type: r.relation_type,
                })),
                ...inRels.map((r) => ({
                  id: r.id,
                  source_id: r.source_id,
                  type: r.relation_type,
                })),
              ],
              memories: entityMems.map((m) =>
                isCompact
                  ? { id: m.id, type: m.type }
                  : { id: m.id, content: trunc(m.content), type: m.type },
              ),
            };
          }),
      );
      const entityIds = semanticResults.filter((r) => r.kind === "entity").length;
      const ranked = await memories.recallMemories(env.DB, namespace_id, {
        limit: Math.max(1, n - entityIds),
      });
      return txt({
        matches: semanticResults.map(mapMatch),
        entities: entityContext,
        top_memories: ranked.map((m) => ({
          id: m.id,
          type: m.type,
          ...(isCompact
            ? {}
            : { content: full ? m.content : trunc(m.content), importance: m.importance }),
        })),
      });
    }),
  );
}
