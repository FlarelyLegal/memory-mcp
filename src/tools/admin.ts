/** Tool registration: reindex_vectors */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import * as embeddings from "../embeddings.js";
import { assertNamespaceAccess } from "../auth.js";
import { txt } from "../response-helpers.js";

export function registerAdminTools(server: McpServer, env: Env, email: string) {
  server.tool(
    "reindex_vectors",
    "Re-embed all entities and memories into Vectorize. Use after model changes.",
    {
      namespace_id: z.string().describe("Namespace ID or 'all'"),
    },
    async ({ namespace_id }) => {
      if (namespace_id !== "all") {
        await assertNamespaceAccess(env.DB, namespace_id, email);
      }

      let entityCount = 0;
      let memoryCount = 0;
      let errorCount = 0;

      const entityQuery =
        namespace_id === "all"
          ? "SELECT e.id, e.namespace_id, e.name, e.type, e.summary FROM entities e JOIN namespaces n ON n.id = e.namespace_id WHERE n.owner = ? OR n.owner IS NULL"
          : "SELECT id, namespace_id, name, type, summary FROM entities WHERE namespace_id = ?";
      const entityResult = await env.DB.prepare(entityQuery)
        .bind(namespace_id === "all" ? email : namespace_id)
        .all<{
          id: string;
          namespace_id: string;
          name: string;
          type: string;
          summary: string | null;
        }>();

      for (const entity of entityResult.results) {
        try {
          await embeddings.upsertEntityVector(env, {
            entity_id: entity.id,
            namespace_id: entity.namespace_id,
            name: entity.name,
            type: entity.type,
            summary: entity.summary,
          });
          entityCount++;
        } catch {
          errorCount++;
        }
      }

      const memoryQuery =
        namespace_id === "all"
          ? "SELECT m.id, m.namespace_id, m.content, m.type FROM memories m JOIN namespaces n ON n.id = m.namespace_id WHERE n.owner = ? OR n.owner IS NULL"
          : "SELECT id, namespace_id, content, type FROM memories WHERE namespace_id = ?";
      const memoryResult = await env.DB.prepare(memoryQuery)
        .bind(namespace_id === "all" ? email : namespace_id)
        .all<{ id: string; namespace_id: string; content: string; type: string }>();

      for (const memory of memoryResult.results) {
        try {
          await embeddings.upsertMemoryVector(env, {
            memory_id: memory.id,
            namespace_id: memory.namespace_id,
            content: memory.content,
            type: memory.type,
          });
          memoryCount++;
        } catch {
          errorCount++;
        }
      }

      return txt({ entities: entityCount, memories: memoryCount, errors: errorCount });
    },
  );
}
