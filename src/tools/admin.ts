/** Tool registration: admin tools (reindex_vectors, claim_namespaces) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { assertNamespaceAccess, isAdmin } from "../auth.js";
import { claimUnownedNamespaces } from "../graph/namespaces.js";
import { txt, err, ok, toolHandler } from "../response-helpers.js";
import { REINDEX_BATCH_SIZE, chunks, reindexEntityChunk, reindexMemoryChunk } from "../reindex.js";
import type { ReindexEntityItem, ReindexMemoryItem } from "../reindex.js";

export function registerAdminTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "reindex_vectors",
    "Re-embed all entities and memories into Vectorize. Use after model changes.",
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
      if (!(await isAdmin(env.CACHE, email))) return err("admin access required");
      if (namespace_id !== "all") {
        await assertNamespaceAccess(env.DB, namespace_id, email);
      }

      let entityCount = 0;
      let memoryCount = 0;
      let errorCount = 0;

      // --- Entities ---
      const entityQuery =
        namespace_id === "all"
          ? "SELECT e.id, e.namespace_id, e.name, e.type, e.summary FROM entities e JOIN namespaces n ON n.id = e.namespace_id WHERE n.owner = ?"
          : "SELECT id, namespace_id, name, type, summary FROM entities WHERE namespace_id = ?";
      const entityResult = await env.DB.prepare(entityQuery)
        .bind(namespace_id === "all" ? email : namespace_id)
        .all<ReindexEntityItem>();

      for (const chunk of chunks(entityResult.results, REINDEX_BATCH_SIZE)) {
        try {
          entityCount += await reindexEntityChunk(env, chunk);
        } catch {
          errorCount += chunk.length;
        }
      }

      // --- Memories ---
      const memoryQuery =
        namespace_id === "all"
          ? "SELECT m.id, m.namespace_id, m.content, m.type FROM memories m JOIN namespaces n ON n.id = m.namespace_id WHERE n.owner = ?"
          : "SELECT id, namespace_id, content, type FROM memories WHERE namespace_id = ?";
      const memoryResult = await env.DB.prepare(memoryQuery)
        .bind(namespace_id === "all" ? email : namespace_id)
        .all<ReindexMemoryItem>();

      for (const chunk of chunks(memoryResult.results, REINDEX_BATCH_SIZE)) {
        try {
          memoryCount += await reindexMemoryChunk(env, chunk);
        } catch {
          errorCount += chunk.length;
        }
      }

      return txt({ entities: entityCount, memories: memoryCount, errors: errorCount });
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
      if (!(await isAdmin(env.CACHE, email))) return err("admin access required");
      const claimed = await claimUnownedNamespaces(env.DB, email);
      if (claimed === 0) return ok("No unowned namespaces found.");
      return txt({ claimed, owner: email });
    }),
  );
}
