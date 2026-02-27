/** Tool registration: manage_entity, find_entities */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as graph from "../graph/index.js";
import * as vectorize from "../vectorize.js";
import { assertNamespaceAccess, assertEntityAccess } from "../auth.js";
import { parseJson, toISO } from "../utils.js";
import { track, untrack, resolveNamespace } from "../state.js";
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

export function registerEntityTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  server.tool(
    "manage_entity",
    "CRUD for graph entities. Actions: create, get, update, delete.",
    {
      action: z.enum(["create", "get", "update", "delete"]),
      id: z.string().uuid().optional().describe("Required for get/update/delete"),
      namespace_id: z
        .string()
        .uuid()
        .optional()
        .describe("Required for create (defaults to last-used)"),
      name: z.string().min(1).max(200).optional(),
      type: z.string().min(1).max(200).optional().describe("person, concept, project, tool, etc."),
      summary: z.string().max(10000).optional(),
      metadata: z.string().max(5000).optional().describe("JSON string"),
      compact: z.boolean().optional().describe("Default true: return minimal fields (get only)"),
    },
    {
      title: "Manage Entity",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    toolHandler(
      async ({ action, id, namespace_id: nsParam, name, type, summary, metadata, compact }) => {
        const db = session(env.DB, "first-primary");
        const meta = safeMeta(metadata);
        if (isMetaError(meta)) return meta;
        switch (action) {
          case "create": {
            const namespace_id = resolveNamespace(nsParam, agent);
            if (!namespace_id || !name || !type) return err("namespace_id, name, type required");
            await assertNamespaceAccess(db, namespace_id, email);
            const eid = await graph.createEntity(db, {
              namespace_id,
              name,
              type,
              summary,
              metadata: meta,
            });
            await vectorize.upsertEntityVector(env, {
              entity_id: eid,
              namespace_id,
              name,
              type,
              summary: summary ?? null,
            });
            track(agent, { namespace: namespace_id, entity: eid });
            return txt({ id: eid, name, type });
          }
          case "get": {
            if (!id) return err("id required");
            await assertEntityAccess(db, id, email);
            const e = await graph.getEntity(db, id);
            if (!e) return err("Not found");
            track(agent, { namespace: e.namespace_id, entity: id });
            const isCompact = compact ?? true;
            return txt(
              isCompact
                ? { id: e.id, name: e.name, type: e.type, summary: e.summary }
                : {
                    id: e.id,
                    namespace_id: e.namespace_id,
                    name: e.name,
                    type: e.type,
                    summary: e.summary,
                    metadata: parseJson(e.metadata),
                    created_at: toISO(e.created_at),
                    updated_at: toISO(e.updated_at),
                    last_accessed_at: toISO(e.last_accessed_at),
                    access_count: e.access_count,
                  },
            );
          }
          case "update": {
            if (!id) return err("id required");
            if (!name && !type && !summary && !metadata)
              return err("at least one field (name, type, summary, metadata) required");
            await assertEntityAccess(db, id, email);
            await graph.updateEntity(db, id, { name, type, summary, metadata: meta });
            if (name || type || summary) {
              const e = await graph.getEntity(db, id);
              if (e)
                await vectorize.upsertEntityVector(env, {
                  entity_id: id,
                  namespace_id: e.namespace_id,
                  name: e.name,
                  type: e.type,
                  summary: e.summary,
                });
            }
            track(agent, { entity: id });
            return ok(`Updated ${id}`);
          }
          case "delete": {
            if (!id) return err("id required");
            await assertEntityAccess(db, id, email);
            const entity = await graph.getEntity(db, id);
            const label = entity ? `entity "${entity.name}" (${entity.type})` : `entity ${id}`;
            if (!(await confirm(server, `Delete ${label} and all its relations?`)))
              return err("Cancelled");
            await graph.deleteEntity(db, id);
            await vectorize.deleteVector(env, "entity", id);
            untrack(agent, id);
            return ok(`Deleted ${id}`);
          }
        }
      },
    ),
  );

  server.tool(
    "find_entities",
    "Search entities by name/type/keyword in a namespace.",
    {
      namespace_id: z.string().uuid().optional().describe("Defaults to last-used namespace"),
      query: z.string().min(1).max(1000).optional(),
      type: z.string().max(200).optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
      verbose: z.boolean().optional().describe("Default false: disable text truncation"),
    },
    {
      title: "Find Entities",
      readOnlyHint: true,
      openWorldHint: false,
    },
    toolHandler(async ({ namespace_id: nsParam, query, type, limit, compact, verbose }) => {
      const namespace_id = resolveNamespace(nsParam, agent);
      if (!namespace_id) return err("namespace_id required");
      const db = session(env.DB, "first-unconstrained");
      await assertNamespaceAccess(db, namespace_id, email);
      track(agent, { namespace: namespace_id });
      const results = await graph.searchEntities(db, namespace_id, {
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
                metadata: parseJson(r.metadata),
              },
        ),
      );
    }),
  );
}
