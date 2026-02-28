/** Message REST endpoints (get, add, search). */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import { addMessage, getMessages, getConversation, searchMessages } from "../../conversations.js";
import {
  assertNamespaceReadAccess,
  assertConversationAccess,
  assertConversationReadAccess,
} from "../../auth.js";
import { upsertMessageVector } from "../../vectorize.js";
import {
  nsPathParam,
  idPathParam,
  limitQueryParam,
  queryLimit,
  messageSchema,
  zodSchema,
} from "../schemas.js";
import { messageCreateSchema, searchMessagesQuerySchema } from "../validators.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";
import { parseMessageRow } from "../row-parsers.js";
import { enforceSearchRateLimit } from "../rate-limit.js";
import { audit } from "../../audit.js";

export function registerMessageRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/conversations/:id/messages",
    async (ctx) => {
      try {
        await assertConversationReadAccess(ctx.db, ctx.params.id, ctx.identity);
        const limit = queryLimit(ctx.query, 100, 50);
        const offset = parseCursor(ctx.query);
        const allowed = [
          "id",
          "conversation_id",
          "role",
          "content",
          "metadata",
          "created_at",
        ] as const;
        const fields = parseFields(ctx.query, allowed, {
          compact: ["id", "role", "created_at"],
          full: allowed,
        });
        const rows = await getMessages(ctx.db, ctx.params.id, {
          limit: limit + 1,
          offset,
        });
        const hasMore = rows.length > limit;
        const data = projectRows(rows.slice(0, limit).map(parseMessageRow), fields);
        const response = json(data);
        const cursor = nextCursor(offset, limit, hasMore);
        if (cursor) response.headers.set("X-Next-Cursor", cursor);
        return response;
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
        {
          name: "cursor",
          in: "query",
          description: "Opaque pagination cursor from X-Next-Cursor",
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
        await assertConversationAccess(ctx.db, ctx.params.id, ctx.identity);
        const body = await parseBodyWithSchema(request, messageCreateSchema);
        if (body instanceof Response) return body;

        const msgId = await addMessage(ctx.db, {
          conversation_id: ctx.params.id,
          role: body.role as "user" | "assistant" | "system" | "tool",
          content: body.content,
          metadata: body.metadata,
        });

        if (body.role === "user" || body.role === "assistant") {
          const conv = await getConversation(ctx.db, ctx.params.id);
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
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "message.create",
          email: ctx.email,
          resource_type: "message",
          resource_id: msgId,
          detail: { conversation_id: ctx.params.id, role: body.role },
        });
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
        content: { "application/json": { schema: zodSchema(messageCreateSchema) } },
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
        await assertNamespaceReadAccess(ctx.db, ctx.params.namespace_id, ctx.identity);
        const rl = await enforceSearchRateLimit(ctx, "message-search");
        if (rl) return rl;
        const queryInput = searchMessagesQuerySchema.safeParse({
          q: ctx.query.get("q") ?? undefined,
        });
        if (!queryInput.success) {
          return jsonError(queryInput.error.issues[0]?.message ?? "Invalid query", 400);
        }
        const query = queryInput.data.q;
        const limit = queryLimit(ctx.query, 100, 50);
        const offset = parseCursor(ctx.query);
        const allowed = [
          "id",
          "conversation_id",
          "role",
          "content",
          "metadata",
          "created_at",
        ] as const;
        const fields = parseFields(ctx.query, allowed, {
          compact: ["id", "role", "created_at"],
          full: allowed,
        });
        const rows = await searchMessages(ctx.db, ctx.params.namespace_id, query, {
          limit: limit + 1,
          offset,
        });
        const hasMore = rows.length > limit;
        const data = projectRows(rows.slice(0, limit).map(parseMessageRow), fields);
        const response = json(data);
        const cursor = nextCursor(offset, limit, hasMore);
        if (cursor) response.headers.set("X-Next-Cursor", cursor);
        return response;
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
        {
          name: "cursor",
          in: "query",
          description: "Opaque pagination cursor from X-Next-Cursor",
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
