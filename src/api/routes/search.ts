/** Semantic search REST endpoint + OpenAPI definition. */
import { defineRoute } from "../registry.js";
import { json, parseBodyWithSchema, handleError } from "../middleware.js";
import { assertNamespaceAccess } from "../../auth.js";
import { semanticSearch } from "../../vectorize.js";
import { getEntity, getRelationsFrom, getRelationsTo } from "../../graph/index.js";
import { recallMemories, getMemoriesForEntity } from "../../memories.js";
import { semanticSearchSchema } from "../validators.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";
import { enforceSearchRateLimit } from "../rate-limit.js";

export function registerSearchRoutes(): void {
  defineRoute(
    "POST",
    "/api/v1/namespaces/:namespace_id/search",
    async (ctx, request) => {
      try {
        await assertNamespaceAccess(ctx.env.DB, ctx.params.namespace_id, ctx.email);
        const rl = await enforceSearchRateLimit(ctx, "semantic-search");
        if (rl) return rl;
        const body = await parseBodyWithSchema(request, semanticSearchSchema);
        if (body instanceof Response) return body;
        const allowed = ["id", "kind", "score", "metadata"] as const;
        const fields = parseFields(ctx.query, allowed, {
          compact: ["id", "kind", "score"],
          full: allowed,
        });

        const mode = body.mode ?? "semantic";
        const limit = Math.min(body.limit ?? (mode === "context" ? 5 : 10), 20);
        const offset = parseCursor(ctx.query);
        const kind = body.kind;

        const matches = await semanticSearch(ctx.env, body.query, ctx.params.namespace_id, {
          kind,
          limit: limit + offset + 1,
        });
        const page = matches.slice(offset, offset + limit + 1);
        const hasMore = page.length > limit;
        const pagedMatches = page.slice(0, limit);

        if (mode === "semantic") {
          const response = json({ matches: projectRows(pagedMatches, fields) });
          const cursor = nextCursor(offset, limit, hasMore);
          if (cursor) response.headers.set("X-Next-Cursor", cursor);
          return response;
        }

        // Context mode: enrich entity matches with graph + memories
        const entities: unknown[] = [];
        const entityIds = pagedMatches
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

        const response = json({
          matches: projectRows(pagedMatches, fields),
          entities,
          top_memories: topMemories,
        });
        const cursor = nextCursor(offset, limit, hasMore);
        if (cursor) response.headers.set("X-Next-Cursor", cursor);
        return response;
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
        {
          name: "fields",
          in: "query",
          description: "Comma-separated match fields to include",
          schema: { type: "string" },
        },
        {
          name: "cursor",
          in: "query",
          description: "Opaque pagination cursor from X-Next-Cursor",
          schema: { type: "string" },
        },
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
