/** Conversation REST endpoints + OpenAPI definitions. */
import { defineRoute } from "../registry.js";
import { json, parseBody, handleError } from "../middleware.js";
import { createConversation, listConversations } from "../../conversations.js";
import { assertNamespaceAccess } from "../../auth.js";
import {
  nsPathParam,
  limitQueryParam,
  queryLimit,
  conversationSchema,
  metadataSchema,
} from "../schemas.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";
import { parseConversationRow } from "../row-parsers.js";
import { audit } from "../../audit.js";

export function registerConversationRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces/:namespace_id/conversations",
    async (ctx) => {
      try {
        await assertNamespaceAccess(ctx.db, ctx.params.namespace_id, ctx.email);
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
        await assertNamespaceAccess(ctx.db, ctx.params.namespace_id, ctx.email);
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
            schema: {
              type: "object",
              properties: {
                title: { type: "string", maxLength: 500 },
                metadata: metadataSchema(),
              },
            },
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
}
