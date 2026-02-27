/** Tool registration: manage_entity */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nameField, typeField, summaryField, metadataObject } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as graph from "../graph/index.js";
import * as vectorize from "../vectorize.js";
import {
  assertNamespaceWriteAccess,
  assertEntityAccess,
  assertEntityReadAccess,
  isAdmin,
} from "../auth.js";
import { parseJson, toISO } from "../utils.js";
import { track, untrack, resolveNamespace } from "../state.js";
import { audit } from "../audit.js";
import { txt, err, ok, trackTools, confirm } from "../response-helpers.js";

export function registerEntityTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
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
      name: nameField.optional(),
      type: typeField.optional().describe("person, concept, project, tool, etc."),
      summary: summaryField.optional(),
      metadata: metadataObject.optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields (get only)"),
    },
    {
      title: "Manage Entity",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked(
      "manage_entity",
      async ({ action, id, namespace_id: nsParam, name, type, summary, metadata, compact }) => {
        const db = session(env.DB, "first-primary");
        const admin = action !== "get" ? await isAdmin(env.CACHE, email) : false;
        switch (action) {
          case "create": {
            const namespace_id = resolveNamespace(nsParam, agent);
            if (!namespace_id || !name || !type) return err("namespace_id, name, type required");
            await assertNamespaceWriteAccess(db, namespace_id, email, admin);
            const eid = await graph.createEntity(db, {
              namespace_id,
              name,
              type,
              summary,
              metadata,
            });
            await vectorize.upsertEntityVector(env, {
              entity_id: eid,
              namespace_id,
              name,
              type,
              summary: summary ?? null,
            });
            track(agent, { namespace: namespace_id, entity: eid });
            await audit(db, env.STORAGE, {
              action: "entity.create",
              email,
              namespace_id,
              resource_type: "entity",
              resource_id: eid,
              detail: { name, type },
            });
            return txt({ id: eid, name, type });
          }
          case "get": {
            if (!id) return err("id required");
            await assertEntityReadAccess(db, id, email);
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
            await assertEntityAccess(db, id, email, admin);
            await graph.updateEntity(db, id, { name, type, summary, metadata });
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
            await audit(db, env.STORAGE, {
              action: "entity.update",
              email,
              resource_type: "entity",
              resource_id: id,
              detail: { name, type, summary: !!summary, metadata: !!metadata },
            });
            return ok(`Updated ${id}`);
          }
          case "delete": {
            if (!id) return err("id required");
            await assertEntityAccess(db, id, email, admin);
            const entity = await graph.getEntity(db, id);
            const label = entity ? `entity "${entity.name}" (${entity.type})` : `entity ${id}`;
            if (!(await confirm(server, `Delete ${label} and all its relations?`)))
              return err("Cancelled");
            await graph.deleteEntity(db, id);
            await vectorize.deleteVector(env, "entity", id);
            untrack(agent, id);
            await audit(db, env.STORAGE, {
              action: "entity.delete",
              email,
              namespace_id: entity?.namespace_id,
              resource_type: "entity",
              resource_id: id,
              detail: { name: entity?.name, type: entity?.type },
            });
            return ok(`Deleted ${id}`);
          }
        }
      },
    ),
  );
}
