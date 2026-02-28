/** Tool registration: manage_relation, get_relations */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  relationType,
  relationWeight,
  metadataObject,
  RELATION_DIRECTIONS,
} from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import { loadIdentity } from "../identity.js";
import * as graph from "../graph/index.js";
import {
  assertNamespaceWriteAccess,
  assertEntityAccess,
  assertEntityReadAccess,
  assertRelationAccess,
} from "../auth.js";
import { parseJson } from "../utils.js";
import { track, resolveNamespace } from "../state.js";
import { audit } from "../audit.js";
import { txt, err, ok, cap, trackTools, confirm } from "../response-helpers.js";

export function registerRelationTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "manage_relation",
    "Create or delete a directed relation between entities.",
    {
      action: z.enum(["create", "delete"]),
      id: z.string().uuid().optional().describe("Required for delete"),
      namespace_id: z
        .string()
        .uuid()
        .optional()
        .describe("Required for create (defaults to last-used)"),
      source_id: z.string().uuid().optional().describe("From entity"),
      target_id: z.string().uuid().optional().describe("To entity"),
      relation_type: relationType.optional().describe("knows, uses, depends_on, part_of, etc."),
      weight: relationWeight.optional(),
      metadata: metadataObject.optional(),
    },
    {
      title: "Manage Relation",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked(
      "manage_relation",
      async ({
        action,
        id,
        namespace_id: nsParam,
        source_id,
        target_id,
        relation_type,
        weight,
        metadata,
      }) => {
        const db = session(env.DB, "first-primary");
        const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
        if (action === "create") {
          const namespace_id = resolveNamespace(nsParam, agent);
          if (!namespace_id || !source_id || !target_id || !relation_type)
            return err("namespace_id, source_id, target_id, relation_type required");
          await assertNamespaceWriteAccess(db, namespace_id, identity);
          const srcNs = await assertEntityAccess(db, source_id, identity);
          const tgtNs = await assertEntityAccess(db, target_id, identity);
          if (srcNs !== namespace_id || tgtNs !== namespace_id)
            return err("source and target entities must belong to the specified namespace");
          const rid = await graph.createRelation(db, {
            namespace_id,
            source_id,
            target_id,
            relation_type,
            weight,
            metadata,
          });
          track(agent, { namespace: namespace_id, entity: [source_id, target_id] });
          await audit(db, env.STORAGE, {
            action: "relation.create",
            email,
            namespace_id,
            resource_type: "relation",
            resource_id: rid,
            detail: { source_id, target_id, relation_type },
          });
          return txt({ id: rid, source_id, target_id, relation_type });
        }
        if (!id) return err("id required");
        await assertRelationAccess(db, id, identity);
        if (!(await confirm(server, `Delete relation ${id}?`))) return err("Cancelled");
        await graph.deleteRelation(db, id);
        await audit(db, env.STORAGE, {
          action: "relation.delete",
          email,
          resource_type: "relation",
          resource_id: id,
        });
        return ok(`Deleted ${id}`);
      },
    ),
  );

  server.tool(
    "get_relations",
    "Get relations from/to an entity.",
    {
      entity_id: z.string().uuid(),
      direction: z.enum(RELATION_DIRECTIONS).optional(),
      relation_type: relationType.optional(),
      limit: z.number().optional(),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
    },
    {
      title: "Get Relations",
      readOnlyHint: true,
      openWorldHint: false,
    },
    tracked("get_relations", async ({ entity_id, direction, relation_type, limit, compact }) => {
      const db = session(env.DB, "first-unconstrained");
      const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
      await assertEntityReadAccess(db, entity_id, identity);
      track(agent, { entity: entity_id });
      const dir = direction ?? "both";
      const n = cap(limit, 50, 20);
      const isCompact = compact ?? true;
      const mapRel = (r: {
        id: string;
        source_id: string;
        target_id: string;
        relation_type: string;
        weight: number;
        metadata: string | null;
      }) =>
        isCompact
          ? {
              id: r.id,
              source_id: r.source_id,
              target_id: r.target_id,
              relation_type: r.relation_type,
              weight: r.weight,
            }
          : {
              id: r.id,
              source_id: r.source_id,
              target_id: r.target_id,
              relation_type: r.relation_type,
              weight: r.weight,
              metadata: parseJson(r.metadata),
            };
      const results: unknown[] = [];
      if (dir === "from" || dir === "both") {
        const rels = await graph.getRelationsFrom(db, entity_id, {
          relation_type,
          limit: n,
        });
        results.push(...rels.map(mapRel));
      }
      if (dir === "to" || dir === "both") {
        const rels = await graph.getRelationsTo(db, entity_id, {
          relation_type,
          limit: n,
        });
        results.push(...rels.map(mapRel));
      }
      return txt(results);
    }),
  );
}
