/** Semantic search REST endpoint + OpenAPI definition. */
import { defineRoute } from "../registry.js";
import { json, parseBodyWithSchema, handleError } from "../middleware.js";
import { zodSchema } from "../schemas.js";
import { assertNamespaceReadAccess } from "../../auth.js";
import { semanticSearch } from "../../vectorize.js";
import { recallMemories } from "../../memories.js";
import { hydrateEntityContext } from "../../context.js";
import { semanticSearchSchema } from "../validators.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";
import { parseEntityRow, parseRelationRow, parseMemoryRow } from "../row-parsers.js";
import { enforceSearchRateLimit } from "../rate-limit.js";

export function registerSearchRoutes(): void {
  defineRoute(
    "POST",
    "/api/v1/namespaces/:namespace_id/search",
    async (ctx, request) => {
      try {
        await assertNamespaceReadAccess(ctx.db, ctx.params.namespace_id, ctx.identity);
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

        const matches = await semanticSearch(ctx.env, ctx.db, body.query, ctx.params.namespace_id, {
          kind: body.kind,
          type: body.type,
          after: body.after,
          before: body.before,
          role: body.role,
          conversation_id: body.conversation_id,
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

        // Context mode: batch-hydrate entity matches (3 queries instead of 4×N)
        const entityIds = pagedMatches
          .filter((m) => m.kind === "entity")
          .map((m) => m.metadata.entity_id)
          .filter(Boolean);

        const contextMap = await hydrateEntityContext(ctx.db, entityIds);
        const entities = entityIds
          .map((eid) => {
            const ec = contextMap.get(eid);
            if (!ec) return null;
            return {
              entity: parseEntityRow(ec.entity),
              relations: [...ec.relationsFrom, ...ec.relationsTo].map(parseRelationRow),
              memories: ec.memories.map(parseMemoryRow),
            };
          })
          .filter(Boolean);

        const topMemories = await recallMemories(ctx.db, ctx.params.namespace_id, {
          limit: Math.max(1, limit - entityIds.length),
        });

        const response = json({
          matches: projectRows(pagedMatches, fields),
          entities,
          top_memories: topMemories.map(parseMemoryRow),
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
        content: { "application/json": { schema: zodSchema(semanticSearchSchema) } },
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
