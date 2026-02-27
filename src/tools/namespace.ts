/** Tool registration: manage_namespace */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import * as graph from "../graph/index.js";
import { assertNamespaceWriteAccess, isAdmin } from "../auth.js";
import { track } from "../state.js";
import { audit } from "../audit.js";
import { txt, err, ok, toolHandler } from "../response-helpers.js";

export function registerNamespaceTools(
  server: McpServer,
  env: Env,
  email: string,
  agent: StateHandle,
) {
  server.tool(
    "manage_namespace",
    "Create, list, or set visibility on memory namespaces.",
    {
      action: z.enum(["create", "list", "set_visibility"]),
      id: z.string().uuid().optional().describe("Required for set_visibility"),
      name: z.string().min(1).max(200).optional().describe("Required for create"),
      description: z.string().max(2000).optional(),
      visibility: z
        .enum(["private", "public"])
        .optional()
        .describe("Required for set_visibility (admin only)"),
      compact: z.boolean().optional().describe("Default true: return minimal fields"),
    },
    {
      title: "Manage Namespace",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    toolHandler(async ({ action, id, name, description, visibility, compact }) => {
      if (action === "create") {
        const db = session(env.DB, "first-primary");
        if (!name) return err("name required");
        const nsId = await graph.createNamespace(db, {
          name,
          description,
          owner: email,
        });
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
      if (action === "set_visibility") {
        if (!id || !visibility) return err("id and visibility required");
        if (!(await isAdmin(env.CACHE, email))) return err("admin access required");
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
