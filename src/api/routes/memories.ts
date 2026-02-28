/** Memory CRUD REST endpoints + OpenAPI definitions. */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import { createMemory, getMemory, updateMemory, deleteMemory } from "../../memories.js";
import {
  assertNamespaceWriteAccess,
  assertMemoryAccess,
  assertMemoryReadAccess,
} from "../../auth.js";
import { upsertMemoryVector, deleteVector } from "../../vectorize.js";
import { nsPathParam, idPathParam, memorySchema, okSchema, zodSchema } from "../schemas.js";
import { parseMemoryRow } from "../row-parsers.js";
import type { MemoryType } from "../../types.js";
import { memoryCreateSchema, memoryUpdateSchema } from "../validators.js";
import { audit } from "../../audit.js";

export function registerMemoryRoutes(): void {
  defineRoute(
    "POST",
    "/api/v1/namespaces/:namespace_id/memories",
    async (ctx, request) => {
      try {
        await assertNamespaceWriteAccess(ctx.db, ctx.params.namespace_id, ctx.identity);
        const body = await parseBodyWithSchema(request, memoryCreateSchema);
        if (body instanceof Response) return body;

        const id = await createMemory(ctx.db, {
          namespace_id: ctx.params.namespace_id,
          content: body.content,
          type: body.type as MemoryType | undefined,
          importance: body.importance,
          source: body.source,
          entity_ids: body.entity_ids,
          metadata: body.metadata,
        });
        await upsertMemoryVector(ctx.env, {
          memory_id: id,
          namespace_id: ctx.params.namespace_id,
          content: body.content,
          type: body.type ?? "fact",
        });
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "memory.create",
          email: ctx.email,
          namespace_id: ctx.params.namespace_id,
          resource_type: "memory",
          resource_id: id,
          detail: { type: body.type ?? "fact" },
        });
        return json({ id, type: body.type ?? "fact" }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create memory",
      description: "Store a memory fragment and embed it for semantic search.",
      tags: ["Memories"],
      operationId: "createMemory",
      parameters: [nsPathParam()],
      requestBody: {
        required: true,
        content: { "application/json": { schema: zodSchema(memoryCreateSchema) } },
      },
      responses: {
        "201": {
          description: "Memory created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { id: { type: "string" }, type: { type: "string" } },
              },
            },
          },
        },
      },
    },
  );

  defineRoute(
    "GET",
    "/api/v1/memories/:id",
    async (ctx) => {
      try {
        await assertMemoryReadAccess(ctx.db, ctx.params.id, ctx.identity);
        const row = await getMemory(ctx.db, ctx.params.id);
        if (!row) return jsonError("Memory not found", 404);
        return json(parseMemoryRow(row));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get memory",
      tags: ["Memories"],
      operationId: "getMemory",
      parameters: [idPathParam("Memory ID")],
      responses: {
        "200": {
          description: "Memory",
          content: {
            "application/json": { schema: memorySchema() },
          },
        },
      },
    },
  );

  defineRoute(
    "PUT",
    "/api/v1/memories/:id",
    async (ctx, request) => {
      try {
        await assertMemoryAccess(ctx.db, ctx.params.id, ctx.identity);
        const body = await parseBodyWithSchema(request, memoryUpdateSchema);
        if (body instanceof Response) return body;
        await updateMemory(ctx.db, ctx.params.id, body);
        if (body.content) {
          const updated = await getMemory(ctx.db, ctx.params.id);
          if (updated) {
            await upsertMemoryVector(ctx.env, {
              memory_id: ctx.params.id,
              namespace_id: updated.namespace_id,
              content: updated.content,
              type: updated.type,
            });
          }
        }
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "memory.update",
          email: ctx.email,
          resource_type: "memory",
          resource_id: ctx.params.id,
          detail: { content: !!body.content, type: body.type, importance: body.importance },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Update memory",
      tags: ["Memories"],
      operationId: "updateMemory",
      parameters: [idPathParam("Memory ID")],
      requestBody: {
        content: { "application/json": { schema: zodSchema(memoryUpdateSchema) } },
      },
      responses: {
        "200": {
          description: "Updated",
          content: {
            "application/json": { schema: okSchema() },
          },
        },
      },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/memories/:id",
    async (ctx) => {
      try {
        await assertMemoryAccess(ctx.db, ctx.params.id, ctx.identity);
        await deleteMemory(ctx.db, ctx.params.id);
        await deleteVector(ctx.env, "memory", ctx.params.id);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "memory.delete",
          email: ctx.email,
          resource_type: "memory",
          resource_id: ctx.params.id,
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Delete memory",
      tags: ["Memories"],
      operationId: "deleteMemory",
      parameters: [idPathParam("Memory ID")],
      responses: {
        "200": {
          description: "Deleted",
          content: {
            "application/json": { schema: okSchema() },
          },
        },
      },
    },
  );
}
