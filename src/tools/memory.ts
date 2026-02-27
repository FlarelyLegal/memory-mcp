/** Tool registration: manage_memory, query_memories */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as memories from "../memories.js";
import * as vectorize from "../vectorize.js";
import { assertNamespaceAccess, assertEntityAccess, assertMemoryAccess } from "../auth.js";
import { track, resolveNamespace } from "../state.js";
import {
  txt,
  err,
  ok,
  cap,
  trunc,
  safeMeta,
  isMetaError,
  toolHandler,
  confirm,
} from "../response-helpers.js";

export function registerMemoryTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  server.tool(
    "manage_memory",
    "Create, update, or delete a memory (knowledge fragment).",
    {
      action: z.enum(["create", "update", "delete"]),
      id: z.string().uuid().optional().describe("Required for update/delete"),
      namespace_id: z
        .string()
        .uuid()
        .optional()
        .describe("Required for create (defaults to last-used)"),
      content: z.string().min(1).max(10000).optional().describe("Required for create"),
      type: z.enum(["fact", "observation", "preference", "instruction"]).optional(),
      importance: z.number().min(0).max(1).optional().describe("0.0-1.0, higher decays slower"),
      source: z.string().max(500).optional().describe("Create only: where this came from"),
      entity_ids: z
        .array(z.string().uuid())
        .max(100)
        .optional()
        .describe("Create only: link to entities"),
      metadata: z.string().max(5000).optional(),
    },
    {
      title: "Manage Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    toolHandler(
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
        switch (action) {
          case "create": {
            const namespace_id = resolveNamespace(nsParam, agent);
            if (!namespace_id || !content) return err("namespace_id, content required");
            await assertNamespaceAccess(db, namespace_id, email);
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
            return txt({ id: mid, type: type ?? "fact" });
          }
          case "update": {
            if (!id) return err("id required");
            if (!content && !type && importance === undefined && !metadata)
              return err("at least one field (content, type, importance, metadata) required");
            await assertMemoryAccess(db, id, email);
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
            return ok(`Updated ${id}`);
          }
          case "delete": {
            if (!id) return err("id required");
            await assertMemoryAccess(db, id, email);
            const m = await memories.getMemory(db, id);
            const label = m ? `memory (${m.type}): "${trunc(m.content, 60)}"` : `memory ${id}`;
            if (!(await confirm(server, `Delete ${label}?`))) return err("Cancelled");
            await memories.deleteMemory(db, id);
            await vectorize.deleteVector(env, "memory", id);
            return ok(`Deleted ${id}`);
          }
        }
      },
    ),
  );

  server.tool(
    "query_memories",
    "Retrieve memories. Modes: recall (ranked by importance+recency), search (keyword), entity (linked to an entity).",
    {
      mode: z.enum(["recall", "search", "entity"]),
      namespace_id: z
        .string()
        .uuid()
        .optional()
        .describe("For recall/search (defaults to last-used)"),
      entity_id: z.string().uuid().optional().describe("Required for entity mode"),
      query: z.string().min(1).max(1000).optional().describe("Required for search mode"),
      type: z.enum(["fact", "observation", "preference", "instruction"]).optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Query Memories",
      readOnlyHint: true,
      openWorldHint: false,
    },
    toolHandler(
      async ({ mode, namespace_id: nsParam, entity_id, query, type, limit, compact, verbose }) => {
        const db = session(env.DB, "first-unconstrained");
        const n = cap(limit, 50, 20);
        const isCompact = compact ?? true;
        const full = verbose ?? false;
        const mapMemory = (m: {
          id: string;
          type: string;
          content: string;
          importance?: number;
          source?: string | null;
        }) =>
          isCompact
            ? { id: m.id, type: m.type }
            : {
                id: m.id,
                type: m.type,
                content: full ? m.content : trunc(m.content),
                importance: m.importance,
                source: m.source,
              };
        switch (mode) {
          case "recall": {
            const namespace_id = resolveNamespace(nsParam, agent);
            if (!namespace_id) return err("namespace_id required");
            await assertNamespaceAccess(db, namespace_id, email);
            track(agent, { namespace: namespace_id });
            const rows = await memories.recallMemories(db, namespace_id, { type, limit: n });
            return txt(rows.map(mapMemory));
          }
          case "search": {
            const namespace_id = resolveNamespace(nsParam, agent);
            if (!namespace_id || !query) return err("namespace_id, query required");
            await assertNamespaceAccess(db, namespace_id, email);
            track(agent, { namespace: namespace_id });
            const rows = await memories.searchMemories(db, namespace_id, {
              query,
              type,
              limit: n,
            });
            return txt(rows.map(mapMemory));
          }
          case "entity": {
            if (!entity_id) return err("entity_id required");
            await assertEntityAccess(db, entity_id, email);
            track(agent, { entity: entity_id });
            const rows = await memories.getMemoriesForEntity(db, entity_id, { limit: n });
            return txt(rows.map(mapMemory));
          }
        }
      },
    ),
  );
}
