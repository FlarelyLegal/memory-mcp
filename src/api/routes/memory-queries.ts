/** Memory query REST endpoints (recall, search, entity-linked). */
import { defineRoute } from "../registry.js";
import { json, jsonError, handleError } from "../middleware.js";
import { recallMemories, searchMemories, getMemoriesForEntity } from "../../memories.js";
import { assertNamespaceReadAccess, assertEntityReadAccess } from "../../auth.js";
import {
  nsPathParam,
  idPathParam,
  limitQueryParam,
  queryLimit,
  memorySchema,
  memoryTypeEnum,
} from "../schemas.js";
import { parseMemoryRow } from "../row-parsers.js";
import type { MemoryType } from "../../types.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";

export function registerMemoryQueryRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces/:namespace_id/memories",
    async (ctx) => {
      try {
        await assertNamespaceReadAccess(ctx.db, ctx.params.namespace_id, ctx.email);
        const mode = ctx.query.get("mode") ?? "recall";
        const type = ctx.query.get("type") as MemoryType | undefined;
        const limit = queryLimit(ctx.query, 50);
        const offset = parseCursor(ctx.query);
        const allowed = [
          "id",
          "namespace_id",
          "content",
          "type",
          "source",
          "importance",
          "metadata",
          "created_at",
          "updated_at",
          "last_accessed_at",
          "access_count",
        ] as const;
        const fields = parseFields(ctx.query, allowed, {
          compact: ["id", "type", "importance"],
          full: allowed,
        });

        if (mode === "search") {
          const query = ctx.query.get("q");
          if (!query) return jsonError("q parameter required for search mode", 400);
          const rows = await searchMemories(ctx.db, ctx.params.namespace_id, {
            query,
            type,
            limit: limit + 1,
            offset,
          });
          const hasMore = rows.length > limit;
          const data = projectRows(rows.slice(0, limit).map(parseMemoryRow), fields);
          const response = json(data);
          const cursor = nextCursor(offset, limit, hasMore);
          if (cursor) response.headers.set("X-Next-Cursor", cursor);
          return response;
        }
        const rows = await recallMemories(ctx.db, ctx.params.namespace_id, {
          type,
          limit: limit + 1,
          offset,
        });
        const hasMore = rows.length > limit;
        const data = projectRows(rows.slice(0, limit).map(parseMemoryRow), fields);
        const response = json(data);
        const cursor = nextCursor(offset, limit, hasMore);
        if (cursor) response.headers.set("X-Next-Cursor", cursor);
        return response;
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Query memories",
      description: "Recall (decay-ranked) or search (keyword) memories.",
      tags: ["Memories"],
      operationId: "queryMemories",
      parameters: [
        nsPathParam(),
        { name: "mode", in: "query", schema: { type: "string", enum: ["recall", "search"] } },
        {
          name: "q",
          in: "query",
          description: "Required for search mode",
          schema: { type: "string" },
        },
        {
          name: "type",
          in: "query",
          schema: memoryTypeEnum(),
        },
        {
          name: "fields",
          in: "query",
          description: "Comma-separated fields to include",
          schema: { type: "string" },
        },
        {
          name: "cursor",
          in: "query",
          description: "Opaque pagination cursor from X-Next-Cursor",
          schema: { type: "string" },
        },
        limitQueryParam(50),
      ],
      responses: {
        "200": {
          description: "Array of memories",
          content: {
            "application/json": { schema: { type: "array", items: memorySchema() } },
          },
        },
      },
    },
  );

  defineRoute(
    "GET",
    "/api/v1/entities/:id/memories",
    async (ctx) => {
      try {
        await assertEntityReadAccess(ctx.db, ctx.params.id, ctx.email);
        const limit = queryLimit(ctx.query, 50);
        const offset = parseCursor(ctx.query);
        const allowed = [
          "id",
          "namespace_id",
          "content",
          "type",
          "source",
          "importance",
          "metadata",
          "created_at",
          "updated_at",
          "last_accessed_at",
          "access_count",
        ] as const;
        const fields = parseFields(ctx.query, allowed, {
          compact: ["id", "type", "importance"],
          full: allowed,
        });
        const rows = await getMemoriesForEntity(ctx.db, ctx.params.id, {
          limit: limit + 1,
          offset,
        });
        const hasMore = rows.length > limit;
        const data = projectRows(rows.slice(0, limit).map(parseMemoryRow), fields);
        const response = json(data);
        const cursor = nextCursor(offset, limit, hasMore);
        if (cursor) response.headers.set("X-Next-Cursor", cursor);
        return response;
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get memories for entity",
      description: "Get memories linked to a specific entity.",
      tags: ["Memories"],
      operationId: "getEntityMemories",
      parameters: [
        idPathParam("Entity ID"),
        {
          name: "fields",
          in: "query",
          description: "Comma-separated fields to include",
          schema: { type: "string" },
        },
        {
          name: "cursor",
          in: "query",
          description: "Opaque pagination cursor from X-Next-Cursor",
          schema: { type: "string" },
        },
        limitQueryParam(50),
      ],
      responses: {
        "200": {
          description: "Array of memories",
          content: {
            "application/json": { schema: { type: "array", items: memorySchema() } },
          },
        },
      },
    },
  );
}
