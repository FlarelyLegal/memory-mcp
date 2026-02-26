/** Semantic search REST endpoint + OpenAPI definition. */
import { defineRoute } from "../registry.js";
import { json, jsonError, handleError } from "../middleware.js";
import { assertNamespaceAccess } from "../../auth.js";
import { semanticSearch } from "../../embeddings.js";
import { getEntity, getRelationsFrom, getRelationsTo } from "../../graph/index.js";
import { recallMemories, getMemoriesForEntity } from "../../memories.js";

export function registerSearchRoutes(): void {
  defineRoute(
    "POST",
    "/api/v1/namespaces/:namespace_id/search",
    async (ctx, request) => {
      try {
        await assertNamespaceAccess(ctx.env.DB, ctx.params.namespace_id, ctx.email);
        const body = (await request.json()) as {
          query?: string;
          mode?: string;
          kind?: string;
          limit?: number;
        };
        if (!body.query) return jsonError("query is required", 400);

        const mode = body.mode ?? "semantic";
        const limit = Math.min(body.limit ?? (mode === "context" ? 5 : 10), 20);
        const kind = body.kind as "entity" | "memory" | "message" | undefined;

        const matches = await semanticSearch(ctx.env, body.query, ctx.params.namespace_id, {
          kind,
          limit,
        });

        if (mode === "semantic") {
          return json({ matches });
        }

        // Context mode: enrich entity matches with graph + memories
        const entities: unknown[] = [];
        const entityIds = matches
          .filter((m) => m.kind === "entity")
          .map((m) => m.metadata.entity_id)
          .filter(Boolean);

        for (const eid of entityIds) {
          const entity = await getEntity(ctx.env.DB, eid);
          if (!entity) continue;
          const [from, to, memories] = await Promise.all([
            getRelationsFrom(ctx.env.DB, eid, { limit: 5 }),
            getRelationsTo(ctx.env.DB, eid, { limit: 5 }),
            getMemoriesForEntity(ctx.env.DB, eid, { limit: 5 }),
          ]);
          entities.push({ entity, relations: [...from, ...to], memories });
        }

        const topMemories = await recallMemories(ctx.env.DB, ctx.params.namespace_id, {
          limit: Math.max(1, limit - entityIds.length),
        });

        return json({ matches, entities, top_memories: topMemories });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Semantic search",
      description:
        "Vector search across entities, memories, and messages. " +
        "Use mode=context to enrich results with graph relations and ranked memories.",
      tags: ["Search"],
      operationId: "semanticSearch",
      parameters: [
        { name: "namespace_id", in: "path", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["query"],
              properties: {
                query: { type: "string", maxLength: 1000 },
                mode: { type: "string", enum: ["semantic", "context"], default: "semantic" },
                kind: {
                  type: "string",
                  enum: ["entity", "memory", "message"],
                  description: "Filter by type",
                },
                limit: {
                  type: "integer",
                  maximum: 20,
                  description: "Default 10 (semantic) or 5 (context)",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Search results",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  matches: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        kind: { type: "string" },
                        score: { type: "number" },
                        metadata: { type: "object" },
                      },
                    },
                  },
                  entities: {
                    type: "array",
                    items: { type: "object" },
                    description: "Context mode only",
                  },
                  top_memories: {
                    type: "array",
                    items: { type: "object" },
                    description: "Context mode only",
                  },
                },
              },
            },
          },
        },
      },
    },
  );
}
