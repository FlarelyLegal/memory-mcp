/** Tool registration: search (semantic + context) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as graph from "../graph/index.js";
import * as memories from "../memories.js";
import * as vectorize from "../vectorize.js";
import { assertNamespaceAccess } from "../auth.js";
import { track, resolveNamespace } from "../state.js";
import { txt, err, cap, trunc, toolHandler } from "../response-helpers.js";

export function registerSearchTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  server.tool(
    "search",
    "Semantic vector search across all memory types. Use mode=context to also pull graph relations and ranked memories for matched entities. Supports time-bounded search with after/before (epoch seconds).",
    {
      namespace_id: z.string().uuid().optional().describe("Defaults to last-used namespace"),
      query: z.string().min(1).max(1000),
      mode: z.enum(["semantic", "context"]).optional().describe("Default: semantic"),
      kind: z.enum(["entity", "memory", "message"]).optional().describe("Filter by kind"),
      type: z
        .string()
        .max(200)
        .optional()
        .describe("Filter by entity type or memory type (e.g. person, fact)"),
      after: z.number().optional().describe("Only results created after this epoch (seconds)"),
      before: z.number().optional().describe("Only results created before this epoch (seconds)"),
      role: z
        .enum(["user", "assistant", "system", "tool"])
        .optional()
        .describe("Filter messages by role"),
      conversation_id: z.string().uuid().optional().describe("Filter messages by conversation"),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Search",
      readOnlyHint: true,
      openWorldHint: false,
    },
    toolHandler(
      async ({
        namespace_id: nsParam,
        query,
        mode,
        kind,
        type,
        after,
        before,
        role,
        conversation_id,
        limit,
        compact,
        verbose,
      }) => {
        const namespace_id = resolveNamespace(nsParam, agent);
        if (!namespace_id) return err("namespace_id required");
        const db = session(env.DB, "first-unconstrained");
        await assertNamespaceAccess(db, namespace_id, email);
        track(agent, { namespace: namespace_id });
        const n = cap(limit, 20, mode === "context" ? 5 : 10);
        const isCompact = compact ?? true;
        const full = verbose ?? false;
        const semanticResults = await vectorize.semanticSearch(env, db, query, namespace_id, {
          kind,
          type,
          after,
          before,
          role,
          conversation_id,
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
                graph.getEntity(db, eid),
                graph.getRelationsFrom(db, eid, { limit: 5 }),
                graph.getRelationsTo(db, eid, { limit: 5 }),
                memories.getMemoriesForEntity(db, eid, { limit: 5 }),
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
        const ranked = await memories.recallMemories(db, namespace_id, {
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
      },
    ),
  );
}
