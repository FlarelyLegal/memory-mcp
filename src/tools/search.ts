/** Tool registration: search (semantic + context) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as graph from "../graph/index.js";
import * as memories from "../memories.js";
import * as embeddings from "../embeddings.js";
import { assertNamespaceAccess } from "../auth.js";
import { txt, cap } from "../response-helpers.js";

export function registerSearchTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "search",
    "Semantic vector search across all memory types. Use mode=context to also pull graph relations and ranked memories for matched entities.",
    {
      namespace_id: z.string().max(100),
      query: z.string().max(1000),
      mode: z.enum(["semantic", "context"]).optional().describe("Default: semantic"),
      kind: z.enum(["entity", "memory", "message"]).optional().describe("Filter by type"),
      limit: z.number().optional(),
    },
    async ({ namespace_id, query, mode, kind, limit }) => {
      await assertNamespaceAccess(env.DB, namespace_id, email);
      const n = cap(limit, 20, mode === "context" ? 5 : 10);
      const semanticResults = await embeddings.semanticSearch(env, query, namespace_id, {
        kind,
        limit: n,
      });

      if ((mode ?? "semantic") === "semantic") {
        return txt(
          semanticResults.map((r) => ({
            id: r.id,
            kind: r.kind,
            score: r.score,
            metadata: r.metadata,
          })),
        );
      }

      // Context mode: enrich entity matches with graph + memories
      const entityContext: unknown[] = [];
      for (const result of semanticResults.filter((r) => r.kind === "entity")) {
        const eid = result.metadata.entity_id;
        if (!eid) continue;
        const [entity, outRels, inRels, entityMems] = await Promise.all([
          graph.getEntity(env.DB, eid),
          graph.getRelationsFrom(env.DB, eid, { limit: 5 }),
          graph.getRelationsTo(env.DB, eid, { limit: 5 }),
          memories.getMemoriesForEntity(env.DB, eid, { limit: 5 }),
        ]);
        entityContext.push({
          entity: entity
            ? { id: entity.id, name: entity.name, type: entity.type, summary: entity.summary }
            : null,
          relations: [
            ...outRels.map((r) => ({ id: r.id, target_id: r.target_id, type: r.relation_type })),
            ...inRels.map((r) => ({ id: r.id, source_id: r.source_id, type: r.relation_type })),
          ],
          memories: entityMems.map((m) => ({ id: m.id, content: m.content, type: m.type })),
        });
      }
      const ranked = await memories.recallMemories(env.DB, namespace_id, { limit: n });
      return txt({
        matches: semanticResults.map((r) => ({
          kind: r.kind,
          score: r.score,
          metadata: r.metadata,
        })),
        entities: entityContext,
        top_memories: ranked.map((m) => ({
          id: m.id,
          content: m.content,
          type: m.type,
          importance: m.importance,
        })),
      });
    },
  );
}
