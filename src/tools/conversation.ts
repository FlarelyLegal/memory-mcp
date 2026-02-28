/** Tool registration: manage_conversation */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { titleField, metadataObject } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import { loadIdentity } from "../identity.js";
import * as conversations from "../conversations.js";
import * as vectorize from "../vectorize.js";
import {
  assertNamespaceWriteAccess,
  assertNamespaceReadAccess,
  assertConversationAccess,
} from "../auth.js";
import { toISO } from "../utils.js";
import { track, resolveNamespace } from "../state.js";
import { audit } from "../audit.js";
import { txt, err, ok, cap, confirm, trackTools } from "../response-helpers.js";

export function registerConversationTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "manage_conversation",
    "Create, list, or delete conversations in a namespace.",
    {
      action: z.enum(["create", "list", "delete"]),
      namespace_id: z.string().uuid().optional().describe("Defaults to last-used namespace"),
      id: z.string().uuid().optional().describe("Required for delete"),
      title: titleField.optional(),
      metadata: metadataObject.optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
    },
    {
      title: "Manage Conversation",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked(
      "manage_conversation",
      async ({ action, namespace_id: nsParam, id, title, metadata, limit, compact }) => {
        if (action === "delete") {
          if (!id) return err("id required");
          const db = session(env.DB, "first-primary");
          const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
          const nsId = await assertConversationAccess(db, id, identity);
          const convo = await conversations.getConversation(db, id);
          if (!(await confirm(server, `Delete conversation "${convo?.title ?? id}"?`)))
            return ok("Cancelled");
          const vectorIds = await conversations.collectConversationVectorIds(db, id);
          await conversations.deleteConversation(db, id);
          await vectorize.deleteVectorBatch(env, vectorIds);
          await audit(db, env.STORAGE, {
            action: "conversation.delete",
            email,
            namespace_id: nsId,
            resource_type: "conversation",
            resource_id: id,
            detail: { title: convo?.title, vectors_deleted: vectorIds.length },
          });
          return ok(`Deleted conversation (${vectorIds.length} vectors removed)`);
        }
        const namespace_id = resolveNamespace(nsParam, agent);
        if (!namespace_id) return err("namespace_id required");
        if (action === "create") {
          const db = session(env.DB, "first-primary");
          const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
          await assertNamespaceWriteAccess(db, namespace_id, identity);
          track(agent, { namespace: namespace_id });
          const cid = await conversations.createConversation(db, {
            namespace_id,
            title,
            metadata,
          });
          track(agent, { conversation: cid });
          await audit(db, env.STORAGE, {
            action: "conversation.create",
            email,
            namespace_id,
            resource_type: "conversation",
            resource_id: cid,
            detail: { title },
          });
          return txt({ id: cid, title });
        }
        const db = session(env.DB, "first-unconstrained");
        const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
        await assertNamespaceReadAccess(db, namespace_id, identity);
        track(agent, { namespace: namespace_id });
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
      },
    ),
  );
}
