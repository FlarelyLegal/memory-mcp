/** Tool registration: admin tools (reindex_vectors, claim_namespaces) */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { embedBatch } from "../embeddings.js";
import { assertNamespaceAccess } from "../auth.js";
import { claimUnownedNamespaces } from "../graph/namespaces.js";
import { txt, ok } from "../response-helpers.js";

/** Items per Workers AI + Vectorize batch. Keeps each call well within limits. */
const BATCH_SIZE = 25;

interface EntityItem {
  id: string;
  namespace_id: string;
  name: string;
  type: string;
  summary: string | null;
}

interface MemoryItem {
  id: string;
  namespace_id: string;
  content: string;
  type: string;
}

/**
 * Process a chunk of entities: batch-embed then batch-upsert into Vectorize.
 * Returns [successCount, errorCount].
 */
async function reindexEntityChunk(env: Env, chunk: EntityItem[]): Promise<[number, number]> {
  const texts = chunk.map((e) => [e.name, e.type, e.summary].filter(Boolean).join(" | "));
  const vectors = await embedBatch(env.AI, texts);

  const entries: VectorizeVector[] = chunk.map((e, i) => ({
    id: `entity:${e.id}`,
    values: vectors[i],
    metadata: {
      kind: "entity",
      entity_id: e.id,
      namespace_id: e.namespace_id,
      name: e.name,
      type: e.type,
    },
  }));

  await env.VECTORIZE.upsert(entries);
  return [chunk.length, 0];
}

/**
 * Process a chunk of memories: batch-embed then batch-upsert into Vectorize.
 * Returns [successCount, errorCount].
 */
async function reindexMemoryChunk(env: Env, chunk: MemoryItem[]): Promise<[number, number]> {
  const texts = chunk.map((m) => m.content);
  const vectors = await embedBatch(env.AI, texts);

  const entries: VectorizeVector[] = chunk.map((m, i) => ({
    id: `memory:${m.id}`,
    values: vectors[i],
    metadata: {
      kind: "memory",
      memory_id: m.id,
      namespace_id: m.namespace_id,
      type: m.type,
    },
  }));

  await env.VECTORIZE.upsert(entries);
  return [chunk.length, 0];
}

/** Split an array into chunks of the given size. */
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

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

      // --- Entities ---
      const entityQuery =
        namespace_id === "all"
          ? "SELECT e.id, e.namespace_id, e.name, e.type, e.summary FROM entities e JOIN namespaces n ON n.id = e.namespace_id WHERE n.owner = ?"
          : "SELECT id, namespace_id, name, type, summary FROM entities WHERE namespace_id = ?";
      const entityResult = await env.DB.prepare(entityQuery)
        .bind(namespace_id === "all" ? email : namespace_id)
        .all<EntityItem>();

      for (const chunk of chunks(entityResult.results, BATCH_SIZE)) {
        try {
          const [ok] = await reindexEntityChunk(env, chunk);
          entityCount += ok;
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
        .all<MemoryItem>();

      for (const chunk of chunks(memoryResult.results, BATCH_SIZE)) {
        try {
          const [ok] = await reindexMemoryChunk(env, chunk);
          memoryCount += ok;
        } catch {
          errorCount += chunk.length;
        }
      }

      return txt({ entities: entityCount, memories: memoryCount, errors: errorCount });
    },
  );

  server.tool(
    "claim_namespaces",
    "Claim all unowned namespaces for the logged-in user. Run once to adopt legacy data.",
    {},
    async () => {
      const claimed = await claimUnownedNamespaces(env.DB, email);
      if (claimed === 0) return ok("No unowned namespaces found.");
      return txt({ claimed, owner: email });
    },
  );
}
