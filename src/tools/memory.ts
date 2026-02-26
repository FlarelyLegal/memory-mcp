/** Tool registration: manage_memory, query_memories */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as memories from "../memories.js";
import * as embeddings from "../embeddings.js";
import { assertNamespaceAccess, assertEntityAccess, assertMemoryAccess } from "../auth.js";
import { txt, ok, cap } from "../response-helpers.js";

export function registerMemoryTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_memory",
    "Create, update, or delete a memory (knowledge fragment).",
    {
      action: z.enum(["create", "update", "delete"]),
      id: z.string().max(100).optional().describe("Required for update/delete"),
      namespace_id: z.string().max(100).optional().describe("Required for create"),
      content: z.string().max(10000).optional().describe("Required for create"),
      type: z.enum(["fact", "observation", "preference", "instruction"]).optional(),
      importance: z.number().optional().describe("0.0-1.0, higher decays slower"),
      source: z.string().max(500).optional(),
      entity_ids: z.array(z.string().max(100)).max(100).optional().describe("Link to entities"),
      metadata: z.string().max(5000).optional(),
    },
    async ({
      action,
      id,
      namespace_id,
      content,
      type,
      importance,
      source,
      entity_ids,
      metadata,
    }) => {
      const meta = metadata ? JSON.parse(metadata) : undefined;
      switch (action) {
        case "create": {
          if (!namespace_id || !content) return ok("Error: namespace_id, content required");
          await assertNamespaceAccess(env.DB, namespace_id, email);
          const mid = await memories.createMemory(env.DB, {
            namespace_id,
            content,
            type,
            importance,
            source,
            entity_ids,
            metadata: meta,
          });
          await embeddings.upsertMemoryVector(env, {
            memory_id: mid,
            namespace_id,
            content,
            type: type ?? "fact",
          });
          return txt({ id: mid, type: type ?? "fact" });
        }
        case "update": {
          if (!id) return ok("Error: id required");
          await assertMemoryAccess(env.DB, id, email);
          await memories.updateMemory(env.DB, id, { content, type, importance, metadata: meta });
          if (content) {
            const m = await memories.getMemory(env.DB, id);
            if (m)
              await embeddings.upsertMemoryVector(env, {
                memory_id: id,
                namespace_id: m.namespace_id,
                content: m.content,
                type: m.type,
              });
          }
          return ok(`Updated ${id}`);
        }
        case "delete": {
          if (!id) return ok("Error: id required");
          await assertMemoryAccess(env.DB, id, email);
          await memories.deleteMemory(env.DB, id);
          await embeddings.deleteVector(env, "memory", id);
          return ok(`Deleted ${id}`);
        }
      }
    },
  );

  server.tool(
    "query_memories",
    "Retrieve memories. Modes: recall (ranked by importance+recency), search (keyword), entity (linked to an entity).",
    {
      mode: z.enum(["recall", "search", "entity"]),
      namespace_id: z.string().max(100).optional().describe("Required for recall/search"),
      entity_id: z.string().max(100).optional().describe("Required for entity mode"),
      query: z.string().max(1000).optional().describe("Required for search mode"),
      type: z.enum(["fact", "observation", "preference", "instruction"]).optional(),
      limit: z.number().optional(),
    },
    async ({ mode, namespace_id, entity_id, query, type, limit }) => {
      const n = cap(limit, 50, 20);
      switch (mode) {
        case "recall": {
          if (!namespace_id) return ok("Error: namespace_id required");
          await assertNamespaceAccess(env.DB, namespace_id, email);
          return txt(await memories.recallMemories(env.DB, namespace_id, { type, limit: n }));
        }
        case "search": {
          if (!namespace_id || !query) return ok("Error: namespace_id, query required");
          await assertNamespaceAccess(env.DB, namespace_id, email);
          return txt(
            await memories.searchMemories(env.DB, namespace_id, { query, type, limit: n }),
          );
        }
        case "entity": {
          if (!entity_id) return ok("Error: entity_id required");
          await assertEntityAccess(env.DB, entity_id, email);
          return txt(await memories.getMemoriesForEntity(env.DB, entity_id, { limit: n }));
        }
      }
    },
  );
}
