/** Tool registration: admin tools (reindex, consolidate, workflow status, claim) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { consolidateFields, WORKFLOW_TYPES } from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import { loadIdentity } from "../identity.js";
import { assertNamespaceWriteAccess } from "../auth.js";
import { claimUnownedNamespaces } from "../graph/namespaces.js";
import { getNamespaceStats } from "../stats.js";
import { track } from "../state.js";
import { audit } from "../audit.js";
import { txt, err, ok, trackTools, confirm } from "../response-helpers.js";

export function registerAdminTools(server: McpServer, env: Env, email: string, agent: StateHandle) {
  const tracked = trackTools(env, email);
  server.tool(
    "reindex_vectors",
    "Re-embed all entities and memories into Vectorize via a durable Workflow. Returns instance ID for status tracking.",
    {
      namespace_id: z.string().max(100).describe("Namespace ID or 'all'"),
    },
    {
      title: "Reindex Vectors",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    tracked("reindex_vectors", async ({ namespace_id }) => {
      const db = session(env.DB, "first-primary");
      const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
      if (!identity.isAdmin) return err("admin access required");
      if (namespace_id !== "all") {
        await assertNamespaceWriteAccess(db, namespace_id, identity);
      }
      if (namespace_id === "all") {
        if (!(await confirm(server, "Re-embed ALL entities and memories across all namespaces?")))
          return err("Cancelled");
      } else {
        track(agent, { namespace: namespace_id });
      }

      const instance = await env.REINDEX_WORKFLOW.create({
        params: { namespace_id, email },
      });

      await audit(db, env.STORAGE, {
        action: "workflow.reindex",
        email,
        namespace_id: namespace_id === "all" ? null : namespace_id,
        resource_type: "workflow",
        resource_id: instance.id,
        detail: { namespace_id },
      });
      return txt({ instance_id: instance.id, status: "queued" });
    }),
  );

  server.tool(
    "consolidate_memory",
    "Run memory consolidation: decay sweep, duplicate removal, memory merge, entity summary refresh, and purge. Returns instance ID.",
    {
      ...consolidateFields,
    },
    {
      title: "Consolidate Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked(
      "consolidate_memory",
      async ({
        namespace_id,
        decay_threshold,
        skip_merge,
        merge_threshold,
        skip_summaries,
        purge_after_days,
      }) => {
        const db = session(env.DB, "first-primary");
        const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
        if (!identity.isAdmin) return err("admin access required");
        await assertNamespaceWriteAccess(db, namespace_id, identity);
        track(agent, { namespace: namespace_id });
        if (
          !(await confirm(
            server,
            `Run consolidation on namespace ${namespace_id}? This archives low-relevance memories and purges old archived data.`,
          ))
        )
          return err("Cancelled");

        const instance = await env.CONSOLIDATION_WORKFLOW.create({
          params: {
            namespace_id,
            email,
            decay_threshold,
            skip_merge,
            merge_threshold,
            skip_summaries,
            purge_after_days,
          },
        });

        await audit(db, env.STORAGE, {
          action: "workflow.consolidate",
          email,
          namespace_id,
          resource_type: "workflow",
          resource_id: instance.id,
          detail: {
            decay_threshold,
            skip_merge,
            merge_threshold,
            skip_summaries,
            purge_after_days,
          },
        });
        return txt({ instance_id: instance.id, status: "queued" });
      },
    ),
  );

  server.tool(
    "get_workflow_status",
    "Check the status of a reindex or consolidation workflow instance.",
    {
      workflow: z.enum(WORKFLOW_TYPES),
      instance_id: z.string().max(200).describe("Workflow instance ID"),
    },
    {
      title: "Workflow Status",
      readOnlyHint: true,
      openWorldHint: false,
    },
    tracked("get_workflow_status", async ({ workflow, instance_id }) => {
      const db = session(env.DB, "first-unconstrained");
      const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
      if (!identity.isAdmin) return err("admin access required");
      const binding = workflow === "reindex" ? env.REINDEX_WORKFLOW : env.CONSOLIDATION_WORKFLOW;
      try {
        const instance = await binding.get(instance_id);
        const status = await instance.status();
        return txt(status);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes("not found")) {
          return err(`Workflow instance ${instance_id} not found`);
        }
        throw e;
      }
    }),
  );

  server.tool(
    "namespace_stats",
    "Get aggregate statistics for a namespace: entity/memory/relation counts, avg importance, archived count.",
    {
      namespace_id: z.string().uuid().describe("Namespace ID"),
    },
    {
      title: "Namespace Stats",
      readOnlyHint: true,
      openWorldHint: false,
    },
    tracked("namespace_stats", async ({ namespace_id }) => {
      const db = session(env.DB, "first-unconstrained");
      const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
      await assertNamespaceWriteAccess(db, namespace_id, identity);
      track(agent, { namespace: namespace_id });
      const stats = await getNamespaceStats(db, namespace_id);
      return txt(stats);
    }),
  );

  server.tool(
    "claim_namespaces",
    "Claim all unowned namespaces for the logged-in user. Run once to adopt legacy data.",
    {},
    {
      title: "Claim Namespaces",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    tracked("claim_namespaces", async () => {
      const db = session(env.DB, "first-primary");
      const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
      if (!identity.isAdmin) return err("admin access required");
      if (!(await confirm(server, "Claim all unowned namespaces for your account?")))
        return err("Cancelled");
      const claimed = await claimUnownedNamespaces(db, email);
      if (claimed === 0) return ok("No unowned namespaces found.");
      await audit(db, env.STORAGE, {
        action: "namespace.claim",
        email,
        resource_type: "namespace",
        detail: { claimed },
      });
      return txt({ claimed, owner: email });
    }),
  );
}
