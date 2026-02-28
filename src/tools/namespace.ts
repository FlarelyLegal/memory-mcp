/** Tool registration: manage_namespace */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nameField, descriptionField, visibility } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as graph from "../graph/index.js";
import { deleteVectorBatch } from "../vectorize.js";
import { assertNamespaceWriteAccess, assertNamespaceReadAccess, isAdmin } from "../auth.js";
import { track } from "../state.js";
import { audit } from "../audit.js";
import { toISO } from "../utils.js";
import { txt, err, ok, confirm, trackTools } from "../response-helpers.js";

export function registerNamespaceTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "manage_namespace",
    "Create, list, get, update, delete, or set visibility on memory namespaces.",
    {
      action: z.enum(["create", "list", "get", "update", "delete", "set_visibility"]),
      id: z.string().uuid().optional().describe("Required for get, update, delete, set_visibility"),
      name: nameField.optional().describe("Required for create; optional for update"),
      description: descriptionField.optional(),
      visibility: visibility.optional().describe("Required for set_visibility (admin only)"),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
    },
    {
      title: "Manage Namespace",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked("manage_namespace", async ({ action, id, name, description, visibility, compact }) => {
      if (action === "get") {
        if (!id) return err("id required");
        const db = session(env.DB, "first-unconstrained");
        const ns = await assertNamespaceReadAccess(db, id, email);
        track(agent, { namespace: id });
        return txt({
          id: ns.id,
          name: ns.name,
          description: ns.description,
          owner: ns.owner,
          visibility: ns.visibility,
          created_at: toISO(ns.created_at),
          updated_at: toISO(ns.updated_at),
        });
      }
      if (action === "update") {
        if (!id) return err("id required");
        if (!name && description === undefined) return err("name or description required");
        const db = session(env.DB, "first-primary");
        const admin = await isAdmin(env.FLAGS, email);
        await assertNamespaceWriteAccess(db, id, email, admin);
        await graph.updateNamespace(db, id, { name, description });
        await audit(db, env.STORAGE, {
          action: "namespace.update",
          email,
          namespace_id: id,
          resource_type: "namespace",
          resource_id: id,
          detail: { name, description },
        });
        return ok("Namespace updated");
      }
      if (action === "create") {
        const db = session(env.DB, "first-primary");
        if (!name) return err("name required");
        const nsId = await graph.createNamespace(db, { name, description, owner: email });
        track(agent, { namespace: nsId });
        await audit(db, env.STORAGE, {
          action: "namespace.create",
          email,
          namespace_id: nsId,
          resource_type: "namespace",
          resource_id: nsId,
          detail: { name },
        });
        return txt({ id: nsId, name });
      }
      if (action === "delete") {
        if (!id) return err("id required");
        const db = session(env.DB, "first-primary");
        const admin = await isAdmin(env.FLAGS, email);
        const ns = await assertNamespaceWriteAccess(db, id, email, admin);
        if (!(await confirm(server, `Delete namespace "${ns.name}" and ALL its contents?`)))
          return ok("Cancelled");
        const vectorIds = await graph.collectNamespaceVectorIds(db, id);
        await graph.deleteNamespace(db, id);
        await deleteVectorBatch(env, vectorIds);
        await audit(db, env.STORAGE, {
          action: "namespace.delete",
          email,
          namespace_id: id,
          resource_type: "namespace",
          resource_id: id,
          detail: { name: ns.name, vectors_deleted: vectorIds.length },
        });
        return ok(`Deleted namespace "${ns.name}" (${vectorIds.length} vectors removed)`);
      }
      if (action === "set_visibility") {
        if (!id || !visibility) return err("id and visibility required");
        if (!(await isAdmin(env.FLAGS, email))) return err("admin access required");
        const db = session(env.DB, "first-primary");
        await assertNamespaceWriteAccess(db, id, email, true);
        await graph.updateNamespaceVisibility(db, id, visibility);
        await audit(db, env.STORAGE, {
          action: "namespace.set_visibility",
          email,
          namespace_id: id,
          resource_type: "namespace",
          resource_id: id,
          detail: { visibility },
        });
        return ok(`Visibility set to ${visibility}`);
      }
      const db = session(env.DB, "first-unconstrained");
      const isCompact = compact ?? true;
      const rows = await graph.listNamespaces(db, email);
      return txt(
        rows.map((r) =>
          isCompact
            ? { id: r.id, name: r.name, visibility: r.visibility }
            : {
                id: r.id,
                name: r.name,
                description: r.description,
                visibility: r.visibility,
              },
        ),
      );
    }),
  );
}
