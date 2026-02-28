/** Conversation REST endpoints + OpenAPI definitions. */
import { z } from "zod";
import { defineRoute } from "../registry.js";
import { json, parseBody, handleError } from "../middleware.js";
import {
  createConversation,
  listConversations,
  getConversation,
  collectConversationVectorIds,
  deleteConversation,
} from "../../conversations.js";
import { deleteVectorBatch } from "../../vectorize.js";
import {
  assertNamespaceWriteAccess,
  assertNamespaceReadAccess,
  assertConversationAccess,
  isAdmin,
} from "../../auth.js";
import {
  nsPathParam,
  idPathParam,
  limitQueryParam,
  queryLimit,
  conversationSchema,
  okSchema,
  zodSchema,
} from "../schemas.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";
import { parseConversationRow } from "../row-parsers.js";
import { titleField, metadataObject } from "../../tool-schemas.js";
import { audit } from "../../audit.js";

export function registerConversationRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces/:namespace_id/conversations",
    async (ctx) => {
      try {
        await assertNamespaceReadAccess(ctx.db, ctx.params.namespace_id, ctx.email);
        const limit = queryLimit(ctx.query, 50);
        const offset = parseCursor(ctx.query);
        const allowed = [
          "id",
          "namespace_id",
          "title",
          "metadata",
          "created_at",
          "updated_at",
        ] as const;
        const fields = parseFields(ctx.query, allowed, {
          compact: ["id", "title", "updated_at"],
          full: allowed,
        });
        const rows = await listConversations(ctx.db, ctx.params.namespace_id, {
          limit: limit + 1,
          offset,
        });
        const hasMore = rows.length > limit;
        const data = projectRows(rows.slice(0, limit).map(parseConversationRow), fields);
        const response = json(data);
        const cursor = nextCursor(offset, limit, hasMore);
        if (cursor) response.headers.set("X-Next-Cursor", cursor);
        return response;
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List conversations",
      tags: ["Conversations"],
      operationId: "listConversations",
      parameters: [
        nsPathParam(),
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
          description: "Array of conversations",
          content: {
            "application/json": { schema: { type: "array", items: conversationSchema() } },
          },
        },
      },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/namespaces/:namespace_id/conversations",
    async (ctx, request) => {
      try {
        const admin = await isAdmin(ctx.env.FLAGS, ctx.email);
        await assertNamespaceWriteAccess(ctx.db, ctx.params.namespace_id, ctx.email, admin);
        const body = await parseBody<{ title?: string; metadata?: Record<string, unknown> }>(
          request,
        );
        if (body instanceof Response) return body;

        const id = await createConversation(ctx.db, {
          namespace_id: ctx.params.namespace_id,
          title: body.title,
          metadata: body.metadata,
        });
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "conversation.create",
          email: ctx.email,
          namespace_id: ctx.params.namespace_id,
          resource_type: "conversation",
          resource_id: id,
          detail: { title: body.title },
        });
        return json({ id, title: body.title ?? null }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create conversation",
      tags: ["Conversations"],
      operationId: "createConversation",
      parameters: [nsPathParam()],
      requestBody: {
        content: {
          "application/json": {
            schema: zodSchema(
              z.object({ title: titleField.optional(), metadata: metadataObject.optional() }),
            ),
          },
        },
      },
      responses: {
        "201": {
          description: "Created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { id: { type: "string" }, title: { type: "string", nullable: true } },
              },
            },
          },
        },
      },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/namespaces/:namespace_id/conversations/:id",
    async (ctx) => {
      try {
        const admin = await isAdmin(ctx.env.FLAGS, ctx.email);
        await assertConversationAccess(ctx.db, ctx.params.id, ctx.email, admin);
        const convo = await getConversation(ctx.db, ctx.params.id);
        const vectorIds = await collectConversationVectorIds(ctx.db, ctx.params.id);
        await deleteConversation(ctx.db, ctx.params.id);
        await deleteVectorBatch(ctx.env, vectorIds);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "conversation.delete",
          email: ctx.email,
          namespace_id: ctx.params.namespace_id,
          resource_type: "conversation",
          resource_id: ctx.params.id,
          detail: { title: convo?.title, vectors_deleted: vectorIds.length },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Delete conversation",
      description:
        "Delete a conversation and all its messages. Message vectors are removed from Vectorize.",
      tags: ["Conversations"],
      operationId: "deleteConversation",
      parameters: [nsPathParam(), idPathParam("Conversation ID")],
      responses: {
        "200": {
          description: "Deleted",
          content: { "application/json": { schema: okSchema() } },
        },
      },
    },
  );
}
