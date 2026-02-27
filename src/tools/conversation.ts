/** Tool registration: manage_conversation, add_message, get_messages */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as conversations from "../conversations.js";
import * as vectorize from "../vectorize.js";
import { assertNamespaceAccess, assertConversationAccess } from "../auth.js";
import { txt, ok, cap, trunc } from "../response-helpers.js";

export function registerConversationTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_conversation",
    "Create or list conversations in a namespace.",
    {
      action: z.enum(["create", "list"]),
      namespace_id: z.string().max(100),
      title: z.string().max(500).optional(),
      metadata: z.string().max(5000).optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
    },
    {
      title: "Manage Conversation",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ action, namespace_id, title, metadata, limit, compact }) => {
      await assertNamespaceAccess(env.DB, namespace_id, email);
      if (action === "create") {
        const id = await conversations.createConversation(env.DB, {
          namespace_id,
          title,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        return txt({ id, title });
      }
      const isCompact = compact ?? true;
      const rows = await conversations.listConversations(env.DB, namespace_id, {
        limit: cap(limit, 50, 20),
      });
      return txt(
        rows.map((r) =>
          isCompact
            ? { id: r.id, title: r.title }
            : { id: r.id, title: r.title, metadata: r.metadata },
        ),
      );
    },
  );

  server.tool(
    "add_message",
    "Add a message to a conversation and embed it for search.",
    {
      conversation_id: z.string().max(100),
      role: z.enum(["user", "assistant", "system", "tool"]),
      content: z.string().max(50000),
      metadata: z.string().max(5000).optional(),
    },
    {
      title: "Add Message",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
          await vectorize.upsertMessageVector(env, {
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
      conversation_id: z
        .string()
        .max(100)
        .optional()
        .describe("Get messages from a specific conversation"),
      namespace_id: z
        .string()
        .max(100)
        .optional()
        .describe("Required when using query to search across conversations"),
      query: z
        .string()
        .max(1000)
        .optional()
        .describe("Keyword search across all conversations in namespace"),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Get Messages",
      readOnlyHint: true,
      openWorldHint: false,
    },
    async ({ conversation_id, namespace_id, query, limit, compact, verbose }) => {
      const n = cap(limit, 100, 50);
      const isCompact = compact ?? true;
      const full = verbose ?? false;
      const mapMsg = (m: { id: string; role: string; content: string; created_at: number }) =>
        isCompact
          ? { id: m.id, role: m.role }
          : {
              id: m.id,
              role: m.role,
              content: full ? m.content : trunc(m.content),
              created_at: m.created_at,
            };
      if (query && namespace_id) {
        await assertNamespaceAccess(env.DB, namespace_id, email);
        const rows = await conversations.searchMessages(env.DB, namespace_id, query, { limit: n });
        return txt(rows.map(mapMsg));
      }
      if (!conversation_id) return ok("Error: conversation_id or namespace_id+query required");
      await assertConversationAccess(env.DB, conversation_id, email);
      const rows = await conversations.getMessages(env.DB, conversation_id, { limit: n });
      return txt(rows.map(mapMsg));
    },
  );
}
