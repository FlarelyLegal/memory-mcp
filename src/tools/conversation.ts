/** Tool registration: manage_conversation, add_message, get_messages */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as conversations from "../conversations.js";
import * as embeddings from "../embeddings.js";
import { assertNamespaceAccess, assertConversationAccess } from "../auth.js";
import { txt, ok, cap } from "../response-helpers.js";

export function registerConversationTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_conversation",
    "Create or list conversations in a namespace.",
    {
      action: z.enum(["create", "list"]),
      namespace_id: z.string(),
      title: z.string().optional(),
      metadata: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ action, namespace_id, title, metadata, limit }) => {
      await assertNamespaceAccess(env.DB, namespace_id, email);
      if (action === "create") {
        const id = await conversations.createConversation(env.DB, {
          namespace_id,
          title,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        return txt({ id, title });
      }
      return txt(
        await conversations.listConversations(env.DB, namespace_id, {
          limit: cap(limit, 50, 20),
        }),
      );
    },
  );

  server.tool(
    "add_message",
    "Add a message to a conversation and embed it for search.",
    {
      conversation_id: z.string(),
      role: z.enum(["user", "assistant", "system", "tool"]),
      content: z.string(),
      metadata: z.string().optional(),
    },
    async ({ conversation_id, role, content, metadata }) => {
      await assertConversationAccess(env.DB, conversation_id, email);
      const id = await conversations.addMessage(env.DB, {
        conversation_id,
        role,
        content,
        metadata: metadata ? JSON.parse(metadata) : undefined,
      });
      if (role === "user" || role === "assistant") {
        const convo = await conversations.getConversation(env.DB, conversation_id);
        if (convo)
          await embeddings.upsertMessageVector(env, {
            message_id: id,
            conversation_id,
            namespace_id: convo.namespace_id,
            content,
            role,
          });
      }
      return txt({ id, role });
    },
  );

  server.tool(
    "get_messages",
    "Get or search messages. Without query: returns recent messages. With query: searches across namespace.",
    {
      conversation_id: z.string().optional().describe("Get messages from a specific conversation"),
      namespace_id: z
        .string()
        .optional()
        .describe("Required when using query to search across conversations"),
      query: z.string().optional().describe("Keyword search across all conversations in namespace"),
      limit: z.number().optional(),
    },
    async ({ conversation_id, namespace_id, query, limit }) => {
      const n = cap(limit, 100, 50);
      if (query && namespace_id) {
        await assertNamespaceAccess(env.DB, namespace_id, email);
        return txt(await conversations.searchMessages(env.DB, namespace_id, query, { limit: n }));
      }
      if (!conversation_id) return ok("Error: conversation_id or namespace_id+query required");
      await assertConversationAccess(env.DB, conversation_id, email);
      return txt(await conversations.getMessages(env.DB, conversation_id, { limit: n }));
    },
  );
}
