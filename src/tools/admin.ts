/** Tool registration: admin tools (reindex, consolidate, workflow status, claim) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { session } from "../db.js";
import { assertNamespaceAccess, isAdmin } from "../auth.js";
import { claimUnownedNamespaces } from "../graph/namespaces.js";
import { getNamespaceStats } from "../consolidation.js";
import { txt, err, ok, toolHandler } from "../response-helpers.js";

export function registerAdminTools(server: McpServer, env: Env, email: string) {
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
    toolHandler(async ({ namespace_id }) => {
      const db = session(env.DB, "first-primary");
      if (!(await isAdmin(env.CACHE, email))) return err("admin access required");
      if (namespace_id !== "all") {
        await assertNamespaceAccess(db, namespace_id, email);
      }

      const instance = await env.REINDEX_WORKFLOW.create({
        params: { namespace_id, email },
      });

      return txt({ instance_id: instance.id, status: "queued" });
    }),
  );

  server.tool(
    "consolidate_memory",
    "Run memory consolidation: decay sweep, duplicate removal, entity summary refresh, and purge. Returns instance ID.",
    {
      namespace_id: z.string().uuid().describe("Namespace to consolidate"),
      decay_threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Relevance threshold for archival (default 0.15)"),
      skip_summaries: z
        .boolean()
        .optional()
        .describe("Skip AI entity summary refresh (default false)"),
      purge_after_days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Days before archived memories are purged (default 30)"),
    },
    {
      title: "Consolidate Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    toolHandler(async ({ namespace_id, decay_threshold, skip_summaries, purge_after_days }) => {
      const db = session(env.DB, "first-primary");
      if (!(await isAdmin(env.CACHE, email))) return err("admin access required");
      await assertNamespaceAccess(db, namespace_id, email);

      const instance = await env.CONSOLIDATION_WORKFLOW.create({
        params: { namespace_id, email, decay_threshold, skip_summaries, purge_after_days },
      });

      return txt({ instance_id: instance.id, status: "queued" });
    }),
  );

  server.tool(
    "get_workflow_status",
    "Check the status of a reindex or consolidation workflow instance.",
    {
      workflow: z.enum(["reindex", "consolidation"]),
      instance_id: z.string().max(200).describe("Workflow instance ID"),
    },
    {
      title: "Workflow Status",
      readOnlyHint: true,
      openWorldHint: false,
    },
    toolHandler(async ({ workflow, instance_id }) => {
      if (!(await isAdmin(env.CACHE, email))) return err("admin access required");
      const binding = workflow === "reindex" ? env.REINDEX_WORKFLOW : env.CONSOLIDATION_WORKFLOW;
      try {
        const instance = await binding.get(instance_id);
        const status = await instance.status();
        return txt(status);
      } catch {
        return err(`Workflow instance ${instance_id} not found`);
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
    toolHandler(async ({ namespace_id }) => {
      const db = session(env.DB, "first-unconstrained");
      await assertNamespaceAccess(db, namespace_id, email);
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
    toolHandler(async () => {
      const db = session(env.DB, "first-primary");
      if (!(await isAdmin(env.CACHE, email))) return err("admin access required");
      const claimed = await claimUnownedNamespaces(db, email);
      if (claimed === 0) return ok("No unowned namespaces found.");
      return txt({ claimed, owner: email });
    }),
  );
}
