/** Tool registration: manage_conversation, add_message, get_messages */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { session } from "../db.js";
import * as conversations from "../conversations.js";
import * as vectorize from "../vectorize.js";
import { assertNamespaceAccess, assertConversationAccess } from "../auth.js";
import { toISO } from "../utils.js";
import { txt, err, cap, trunc, safeMeta, isMetaError, toolHandler } from "../response-helpers.js";

export function registerConversationTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_conversation",
    "Create or list conversations in a namespace.",
    {
      action: z.enum(["create", "list"]),
      namespace_id: z.string().uuid(),
      title: z.string().min(1).max(500).optional(),
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
    toolHandler(async ({ action, namespace_id, title, metadata, limit, compact }) => {
      const db = session(env.DB, "first-primary");
      await assertNamespaceAccess(db, namespace_id, email);
      if (action === "create") {
        const meta = safeMeta(metadata);
        if (isMetaError(meta)) return meta;
        const id = await conversations.createConversation(db, {
          namespace_id,
          title,
          metadata: meta,
        });
        return txt({ id, title });
      }
      const isCompact = compact ?? true;
      const rows = await conversations.listConversations(db, namespace_id, {
        limit: cap(limit, 50, 20),
      });
      return txt(
        rows.map((r) =>
          isCompact
            ? { id: r.id, title: r.title, updated_at: toISO(r.updated_at) }
            : {
                id: r.id,
                title: r.title,
                metadata: r.metadata,
                created_at: toISO(r.created_at),
                updated_at: toISO(r.updated_at),
              },
        ),
      );
    }),
  );

  server.tool(
    "add_message",
    "Add a message to a conversation and embed it for search.",
    {
      conversation_id: z.string().uuid(),
      role: z.enum(["user", "assistant", "system", "tool"]),
      content: z.string().min(1).max(50000),
      metadata: z.string().max(5000).optional(),
    },
    {
      title: "Add Message",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    toolHandler(async ({ conversation_id, role, content, metadata }) => {
      const db = session(env.DB, "first-primary");
      await assertConversationAccess(db, conversation_id, email);
      const meta = safeMeta(metadata);
      if (isMetaError(meta)) return meta;
      const id = await conversations.addMessage(db, {
        conversation_id,
        role,
        content,
        metadata: meta,
      });
      if (role === "user" || role === "assistant") {
        const convo = await conversations.getConversation(db, conversation_id);
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
    }),
  );

  server.tool(
    "get_messages",
    "Get or search messages. Without query: returns recent messages. With query: searches across namespace.",
    {
      conversation_id: z
        .string()
        .uuid()
        .optional()
        .describe("Get messages from a specific conversation"),
      namespace_id: z
        .string()
        .uuid()
        .optional()
        .describe("Required when using query to search across conversations"),
      query: z
        .string()
        .min(1)
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
    toolHandler(async ({ conversation_id, namespace_id, query, limit, compact, verbose }) => {
      const db = session(env.DB, "first-unconstrained");
      const n = cap(limit, 100, 50);
      const isCompact = compact ?? true;
      const full = verbose ?? false;
      const mapMsg = (m: {
        id: string;
        role: string;
        content: string;
        created_at: number;
        conversation_title?: string | null;
      }) =>
        isCompact
          ? { id: m.id, role: m.role }
          : {
              id: m.id,
              role: m.role,
              content: full ? m.content : trunc(m.content),
              created_at: toISO(m.created_at),
              ...(m.conversation_title !== undefined
                ? { conversation_title: m.conversation_title }
                : {}),
            };
      if (query && namespace_id) {
        await assertNamespaceAccess(db, namespace_id, email);
        const rows = await conversations.searchMessages(db, namespace_id, query, { limit: n });
        return txt(rows.map(mapMsg));
      }
      if (!conversation_id) return err("conversation_id or namespace_id+query required");
      await assertConversationAccess(db, conversation_id, email);
      const rows = await conversations.getMessages(db, conversation_id, { limit: n });
      return txt(rows.map(mapMsg));
    }),
  );
}
