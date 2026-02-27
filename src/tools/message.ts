/** Tool registration: add_message, get_messages */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { messageRole, messageContent, metadataJsonStr, queryField } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as conversations from "../conversations.js";
import * as vectorize from "../vectorize.js";
import {
  assertConversationAccess,
  assertConversationReadAccess,
  assertNamespaceReadAccess,
  isAdmin,
} from "../auth.js";
import { toISO } from "../utils.js";
import { track, resolveNamespace, resolveConversation } from "../state.js";
import { audit } from "../audit.js";
import { txt, err, cap, trunc, safeMeta, isMetaError, trackTools } from "../response-helpers.js";

export function registerMessageTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "add_message",
    "Add a message to a conversation and embed it for search.",
    {
      conversation_id: z.string().uuid().optional().describe("Defaults to last-used conversation"),
      role: messageRole,
      content: messageContent,
      metadata: metadataJsonStr.optional(),
    },
    {
      title: "Add Message",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked("add_message", async ({ conversation_id: cParam, role, content, metadata }) => {
      const conversation_id = resolveConversation(cParam, agent);
      if (!conversation_id) return err("conversation_id required");
      const db = session(env.DB, "first-primary");
      const admin = await isAdmin(env.CACHE, email);
      await assertConversationAccess(db, conversation_id, email, admin);
      track(agent, { conversation: conversation_id });
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
      await audit(db, env.STORAGE, {
        action: "message.create",
        email,
        resource_type: "message",
        resource_id: id,
        detail: { conversation_id, role },
      });
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
      query: queryField.optional().describe("Keyword search across all conversations in namespace"),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Get Messages",
      readOnlyHint: true,
      openWorldHint: false,
    },
    tracked(
      "get_messages",
      async ({
        conversation_id: cParam,
        namespace_id: nsParam,
        query,
        limit,
        compact,
        verbose,
      }) => {
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
        const namespace_id = resolveNamespace(nsParam, agent);
        if (query && namespace_id) {
          await assertNamespaceReadAccess(db, namespace_id, email);
          track(agent, { namespace: namespace_id });
          const rows = await conversations.searchMessages(db, namespace_id, query, { limit: n });
          return txt(rows.map(mapMsg));
        }
        const conversation_id = resolveConversation(cParam, agent);
        if (!conversation_id) return err("conversation_id or namespace_id+query required");
        await assertConversationReadAccess(db, conversation_id, email);
        track(agent, { conversation: conversation_id });
        const rows = await conversations.getMessages(db, conversation_id, { limit: n });
        return txt(rows.map(mapMsg));
      },
    ),
  );
}
