/** Message REST endpoints (get, add, search). */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import { addMessage, getMessages, getConversation, searchMessages } from "../../conversations.js";
import { assertNamespaceAccess, assertConversationAccess } from "../../auth.js";
import { upsertMessageVector } from "../../embeddings.js";
import {
  nsPathParam,
  idPathParam,
  limitQueryParam,
  queryLimit,
  messageSchema,
  metadataSchema,
  roleEnum,
} from "../schemas.js";
import { messageCreateSchema, searchMessagesQuerySchema } from "../validators.js";
import { parseFields, projectRows } from "../fields.js";

export function registerMessageRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/conversations/:id/messages",
    async (ctx) => {
      try {
        await assertConversationAccess(ctx.env.DB, ctx.params.id, ctx.email);
        const limit = queryLimit(ctx.query, 100, 50);
        const fields = parseFields(ctx.query, [
          "id",
          "conversation_id",
          "role",
          "content",
          "metadata",
          "created_at",
        ]);
        const rows = await getMessages(ctx.env.DB, ctx.params.id, { limit });
        return json(projectRows(rows, fields));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get messages",
      description: "Get messages from a conversation in chronological order.",
      tags: ["Conversations"],
      operationId: "getMessages",
      parameters: [
        idPathParam("Conversation ID"),
        {
          name: "fields",
          in: "query",
          description: "Comma-separated fields to include",
          schema: { type: "string" },
        },
        limitQueryParam(100),
      ],
      responses: {
        "200": {
          description: "Array of messages",
          content: {
            "application/json": { schema: { type: "array", items: messageSchema() } },
          },
        },
      },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/conversations/:id/messages",
    async (ctx, request) => {
      try {
        await assertConversationAccess(ctx.env.DB, ctx.params.id, ctx.email);
        const body = await parseBodyWithSchema(request, messageCreateSchema);
        if (body instanceof Response) return body;

        const msgId = await addMessage(ctx.env.DB, {
          conversation_id: ctx.params.id,
          role: body.role as "user" | "assistant" | "system" | "tool",
          content: body.content,
          metadata: body.metadata,
        });

        if (body.role === "user" || body.role === "assistant") {
          const conv = await getConversation(ctx.env.DB, ctx.params.id);
          if (conv) {
            await upsertMessageVector(ctx.env, {
              message_id: msgId,
              conversation_id: ctx.params.id,
              namespace_id: conv.namespace_id,
              content: body.content,
              role: body.role,
            });
          }
        }
        return json({ id: msgId, role: body.role }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Add message",
      description: "Add a message and embed user/assistant messages for search.",
      tags: ["Conversations"],
      operationId: "addMessage",
      parameters: [idPathParam("Conversation ID")],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["role", "content"],
              properties: {
                role: roleEnum(),
                content: { type: "string", maxLength: 50000 },
                metadata: metadataSchema(),
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Message added",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { id: { type: "string" }, role: { type: "string" } },
              },
            },
          },
        },
      },
    },
  );

  defineRoute(
    "GET",
    "/api/v1/namespaces/:namespace_id/messages",
    async (ctx) => {
      try {
        await assertNamespaceAccess(ctx.env.DB, ctx.params.namespace_id, ctx.email);
        const queryInput = searchMessagesQuerySchema.safeParse({
          q: ctx.query.get("q") ?? undefined,
        });
        if (!queryInput.success) {
          return jsonError(queryInput.error.issues[0]?.message ?? "Invalid query", 400);
        }
        const query = queryInput.data.q;
        const limit = queryLimit(ctx.query, 100, 50);
        const fields = parseFields(ctx.query, [
          "id",
          "conversation_id",
          "role",
          "content",
          "metadata",
          "created_at",
        ]);
        const rows = await searchMessages(ctx.env.DB, ctx.params.namespace_id, query, { limit });
        return json(projectRows(rows, fields));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Search messages",
      description: "Keyword search across all messages in a namespace.",
      tags: ["Conversations"],
      operationId: "searchMessages",
      parameters: [
        nsPathParam(),
        {
          name: "q",
          in: "query",
          required: true,
          description: "Search query",
          schema: { type: "string" },
        },
        {
          name: "fields",
          in: "query",
          description: "Comma-separated fields to include",
          schema: { type: "string" },
        },
        limitQueryParam(100),
      ],
      responses: {
        "200": {
          description: "Array of messages",
          content: {
            "application/json": { schema: { type: "array", items: messageSchema() } },
          },
        },
      },
    },
  );
}
