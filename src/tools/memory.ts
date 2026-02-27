/** Tool registration: manage_memory */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  memoryContent,
  memoryType,
  importance,
  sourceField,
  entityIds,
  metadataJsonStr,
} from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as memories from "../memories.js";
import * as vectorize from "../vectorize.js";
import {
  assertNamespaceWriteAccess,
  assertMemoryAccess,
  assertMemoryReadAccess,
  isAdmin,
} from "../auth.js";
import { track, resolveNamespace } from "../state.js";
import { audit } from "../audit.js";
import {
  txt,
  err,
  ok,
  trunc,
  safeMeta,
  isMetaError,
  trackTools,
  confirm,
} from "../response-helpers.js";

export function registerMemoryTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "manage_memory",
    "Get, create, update, or delete a memory (knowledge fragment).",
    {
      action: z.enum(["create", "get", "update", "delete"]),
      id: z.string().uuid().optional().describe("Required for get/update/delete"),
      namespace_id: z
        .string()
        .uuid()
        .optional()
        .describe("Required for create (defaults to last-used)"),
      content: memoryContent.optional().describe("Required for create"),
      type: memoryType.optional(),
      importance: importance.optional().describe("0.0-1.0, higher decays slower"),
      source: sourceField.optional().describe("Create only: where this came from"),
      entity_ids: entityIds.optional().describe("Create only: link to entities"),
      metadata: metadataJsonStr.optional(),
    },
    {
      title: "Manage Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked(
      "manage_memory",
      async ({
        action,
        id,
        namespace_id: nsParam,
        content,
        type,
        importance,
        source,
        entity_ids,
        metadata,
      }) => {
        const db = session(env.DB, "first-primary");
        const meta = safeMeta(metadata);
        if (isMetaError(meta)) return meta;
        const admin = await isAdmin(env.CACHE, email);
        switch (action) {
          case "get": {
            if (!id) return err("id required");
            await assertMemoryReadAccess(db, id, email);
            const m = await memories.getMemory(db, id);
            if (!m) return err("Memory not found");
            return txt(m);
          }
          case "create": {
            const namespace_id = resolveNamespace(nsParam, agent);
            if (!namespace_id || !content) return err("namespace_id, content required");
            await assertNamespaceWriteAccess(db, namespace_id, email, admin);
            const mid = await memories.createMemory(db, {
              namespace_id,
              content,
              type,
              importance,
              source,
              entity_ids,
              metadata: meta,
            });
            await vectorize.upsertMemoryVector(env, {
              memory_id: mid,
              namespace_id,
              content,
              type: type ?? "fact",
            });
            track(agent, { namespace: namespace_id, entity: entity_ids });
            await audit(db, env.STORAGE, {
              action: "memory.create",
              email,
              namespace_id,
              resource_type: "memory",
              resource_id: mid,
              detail: { type: type ?? "fact", entity_ids },
            });
            return txt({ id: mid, type: type ?? "fact" });
          }
          case "update": {
            if (!id) return err("id required");
            if (!content && !type && importance === undefined && !metadata)
              return err("at least one field (content, type, importance, metadata) required");
            await assertMemoryAccess(db, id, email, admin);
            await memories.updateMemory(db, id, { content, type, importance, metadata: meta });
            if (content) {
              const m = await memories.getMemory(db, id);
              if (m)
                await vectorize.upsertMemoryVector(env, {
                  memory_id: id,
                  namespace_id: m.namespace_id,
                  content: m.content,
                  type: m.type,
                });
            }
            await audit(db, env.STORAGE, {
              action: "memory.update",
              email,
              resource_type: "memory",
              resource_id: id,
              detail: { content: !!content, type, importance },
            });
            return ok(`Updated ${id}`);
          }
          case "delete": {
            if (!id) return err("id required");
            await assertMemoryAccess(db, id, email, admin);
            const m = await memories.getMemory(db, id);
            const label = m ? `memory (${m.type}): "${trunc(m.content, 60)}"` : `memory ${id}`;
            if (!(await confirm(server, `Delete ${label}?`))) return err("Cancelled");
            await memories.deleteMemory(db, id);
            await vectorize.deleteVector(env, "memory", id);
            await audit(db, env.STORAGE, {
              action: "memory.delete",
              email,
              namespace_id: m?.namespace_id,
              resource_type: "memory",
              resource_id: id,
              detail: { type: m?.type },
            });
            return ok(`Deleted ${id}`);
          }
        }
      },
    ),
  );
}
