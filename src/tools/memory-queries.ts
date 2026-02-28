/** Tool registration: query_memories */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { memoryType, queryField } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import { loadIdentity } from "../identity.js";
import * as memories from "../memories.js";
import { assertNamespaceReadAccess, assertEntityReadAccess } from "../auth.js";
import { track, resolveNamespace } from "../state.js";
import { txt, err, cap, trunc, trackTools } from "../response-helpers.js";

export function registerMemoryQueryTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
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
      query: queryField.optional().describe("Required for search mode"),
      type: memoryType.optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Query Memories",
      readOnlyHint: true,
      openWorldHint: false,
    },
    tracked(
      "query_memories",
      async ({ mode, namespace_id: nsParam, entity_id, query, type, limit, compact, verbose }) => {
        const db = session(env.DB, "first-unconstrained");
        const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
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
            await assertNamespaceReadAccess(db, namespace_id, identity);
            track(agent, { namespace: namespace_id });
            const rows = await memories.recallMemories(db, namespace_id, { type, limit: n });
            return txt(rows.map(mapMemory));
          }
          case "search": {
            const namespace_id = resolveNamespace(nsParam, agent);
            if (!namespace_id || !query) return err("namespace_id, query required");
            await assertNamespaceReadAccess(db, namespace_id, identity);
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
            await assertEntityReadAccess(db, entity_id, identity);
            track(agent, { entity: entity_id });
            const rows = await memories.getMemoriesForEntity(db, entity_id, { limit: n });
            return txt(rows.map(mapMemory));
          }
        }
      },
    ),
  );
}
