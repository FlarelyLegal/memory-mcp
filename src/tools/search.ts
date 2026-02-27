/** Tool registration: search (semantic + context) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  queryField,
  SEARCH_MODES,
  SEARCH_KINDS,
  typeFilter,
  messageRole,
} from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as memories from "../memories.js";
import * as vectorize from "../vectorize.js";
import { hydrateEntityContext } from "../context.js";
import { assertNamespaceReadAccess } from "../auth.js";
import { track, resolveNamespace } from "../state.js";
import { txt, err, cap, trunc, trackTools } from "../response-helpers.js";

export function registerSearchTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "search",
    "Semantic vector search across all memory types. Use mode=context to also pull graph relations and ranked memories for matched entities. Supports time-bounded search with after/before (epoch seconds).",
    {
      namespace_id: z.string().uuid().optional().describe("Defaults to last-used namespace"),
      query: queryField,
      mode: z.enum(SEARCH_MODES).optional().describe("Default: semantic"),
      kind: z.enum(SEARCH_KINDS).optional().describe("Filter by kind"),
      type: typeFilter
        .optional()
        .describe("Filter by entity type or memory type (e.g. person, fact)"),
      after: z.number().optional().describe("Only results created after this epoch (seconds)"),
      before: z.number().optional().describe("Only results created before this epoch (seconds)"),
      role: messageRole.optional().describe("Filter messages by role"),
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
    tracked(
      "search",
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
        await assertNamespaceReadAccess(db, namespace_id, email);
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

        // Context mode: batch-hydrate entity matches (3 queries instead of 4×N)
        const entityIds = semanticResults
          .filter((r) => r.kind === "entity" && r.metadata.entity_id)
          .map((r) => r.metadata.entity_id as string);
        const contextMap = await hydrateEntityContext(db, entityIds);
        const entityContext = entityIds
          .map((eid) => {
            const ctx = contextMap.get(eid);
            if (!ctx) return null;
            return {
              entity: {
                id: ctx.entity.id,
                name: ctx.entity.name,
                type: ctx.entity.type,
                ...(isCompact
                  ? {}
                  : { summary: full ? ctx.entity.summary : trunc(ctx.entity.summary) }),
              },
              relations: [
                ...ctx.relationsFrom.map((r) => ({
                  id: r.id,
                  target_id: r.target_id,
                  type: r.relation_type,
                })),
                ...ctx.relationsTo.map((r) => ({
                  id: r.id,
                  source_id: r.source_id,
                  type: r.relation_type,
                })),
              ],
              memories: ctx.memories.map((m) =>
                isCompact
                  ? { id: m.id, type: m.type }
                  : { id: m.id, content: trunc(m.content), type: m.type },
              ),
            };
          })
          .filter(Boolean);
        const ranked = await memories.recallMemories(db, namespace_id, {
          limit: Math.max(1, n - entityIds.length),
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
