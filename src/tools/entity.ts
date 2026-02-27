/** Tool registration: manage_entity, find_entities */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as graph from "../graph/index.js";
import * as embeddings from "../embeddings.js";
import { assertNamespaceAccess, assertEntityAccess } from "../auth.js";
import { parseJson } from "../utils.js";
import { txt, ok, cap, trunc } from "../response-helpers.js";

export function registerEntityTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "manage_entity",
    "CRUD for graph entities. Actions: create, get, update, delete.",
    {
      action: z.enum(["create", "get", "update", "delete"]),
      id: z.string().max(100).optional().describe("Required for get/update/delete"),
      namespace_id: z.string().max(100).optional().describe("Required for create"),
      name: z.string().max(200).optional(),
      type: z.string().max(200).optional().describe("person, concept, project, tool, etc."),
      summary: z.string().max(10000).optional(),
      metadata: z.string().max(5000).optional().describe("JSON string"),
    },
    async ({ action, id, namespace_id, name, type, summary, metadata }) => {
      const meta = metadata ? JSON.parse(metadata) : undefined;
      switch (action) {
        case "create": {
          if (!namespace_id || !name || !type)
            return ok("Error: namespace_id, name, type required");
          await assertNamespaceAccess(env.DB, namespace_id, email);
          const eid = await graph.createEntity(env.DB, {
            namespace_id,
            name,
            type,
            summary,
            metadata: meta,
          });
          await embeddings.upsertEntityVector(env, {
            entity_id: eid,
            namespace_id,
            name,
            type,
            summary: summary ?? null,
          });
          return txt({ id: eid, name, type });
        }
        case "get": {
          if (!id) return ok("Error: id required");
          await assertEntityAccess(env.DB, id, email);
          const e = await graph.getEntity(env.DB, id);
          if (!e) return ok("Not found");
          return txt({
            id: e.id,
            name: e.name,
            type: e.type,
            summary: e.summary,
            metadata: parseJson(e.metadata),
          });
        }
        case "update": {
          if (!id) return ok("Error: id required");
          await assertEntityAccess(env.DB, id, email);
          await graph.updateEntity(env.DB, id, { name, type, summary, metadata: meta });
          if (name || type || summary) {
            const e = await graph.getEntity(env.DB, id);
            if (e)
              await embeddings.upsertEntityVector(env, {
                entity_id: id,
                namespace_id: e.namespace_id,
                name: e.name,
                type: e.type,
                summary: e.summary,
              });
          }
          return ok(`Updated ${id}`);
        }
        case "delete": {
          if (!id) return ok("Error: id required");
          await assertEntityAccess(env.DB, id, email);
          await graph.deleteEntity(env.DB, id);
          await embeddings.deleteVector(env, "entity", id);
          return ok(`Deleted ${id}`);
        }
      }
    },
  );

  server.tool(
    "find_entities",
    "Search entities by name/type/keyword in a namespace.",
    {
      namespace_id: z.string().max(100),
      query: z.string().max(1000).optional(),
      type: z.string().max(200).optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    async ({ namespace_id, query, type, limit, compact, verbose }) => {
      await assertNamespaceAccess(env.DB, namespace_id, email);
      const results = await graph.searchEntities(env.DB, namespace_id, {
        query,
        type,
        limit: cap(limit, 50, 20),
      });
      const isCompact = compact ?? true;
      const full = verbose ?? false;
      return txt(
        results.map((r) =>
          isCompact
            ? { id: r.id, name: r.name, type: r.type }
            : {
                id: r.id,
                name: r.name,
                type: r.type,
                summary: full ? r.summary : trunc(r.summary),
              },
        ),
      );
    },
  );
}
