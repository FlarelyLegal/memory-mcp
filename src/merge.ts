/**
 * Memory merge: cluster semantically similar memories and summarize via LLM.
 *
 * Used by the consolidation workflow to reduce redundant memories into
 * concise merged versions. Clustering uses pairwise cosine similarity
 * on embeddings; merging uses Workers AI text generation.
 */
import type { MemoryRow } from "./types.js";
import type { DbHandle } from "./db.js";
import { withRetry } from "./db.js";
import { embedBatch } from "./embeddings.js";
import { generateId, now, toJson } from "./utils.js";
import { aiRun } from "./ai.js";

/** Minimum similarity (0–1) for two memories to be considered mergeable. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/** Maximum memories to consider per namespace (limits embed cost). */
const MAX_MEMORIES = 100;

/** Maximum cluster size sent to the LLM. */
const MAX_CLUSTER_SIZE = 8;

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

export interface MemoryCluster {
  memories: MemoryRow[];
}

/**
 * Find clusters of semantically similar memories in a namespace.
 *
 * 1. Fetch active (non-archived) memories from D1
 * 2. Batch-embed all content via Workers AI
 * 3. Pairwise cosine similarity → adjacency list
 * 4. Connected components with ≥2 members = clusters
 */
export async function findMemoryClusters(
  db: DbHandle,
  ai: Ai,
  namespace_id: string,
  opts?: { threshold?: number },
): Promise<MemoryCluster[]> {
  const threshold = opts?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // Fetch active memories (skip archived)
  const result = await db
    .prepare(
      `SELECT * FROM memories
       WHERE namespace_id = ? AND importance > 0
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(namespace_id, MAX_MEMORIES)
    .all<MemoryRow>();

  const memories = result.results;
  if (memories.length < 2) return [];

  // Batch embed
  const texts = memories.map((m) => m.content);
  const vectors = await embedBatch(ai, texts);

  // Pairwise similarity → adjacency list
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      if (cosine(vectors[i], vectors[j]) >= threshold) {
        if (!adj.has(i)) adj.set(i, new Set());
        if (!adj.has(j)) adj.set(j, new Set());
        adj.get(i)!.add(j);
        adj.get(j)!.add(i);
      }
    }
  }

  // Connected components via BFS
  const visited = new Set<number>();
  const clusters: MemoryCluster[] = [];

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.push(node);
      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    if (component.length >= 2) {
      clusters.push({
        memories: component.slice(0, MAX_CLUSTER_SIZE).map((i) => memories[i]),
      });
    }
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** LLM model for memory merge summarization. */
const MERGE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

/**
 * Merge a cluster of similar memories into one via LLM summarization.
 * Returns the merged content string, or null if LLM fails.
 */
export async function mergeCluster(ai: Ai, cluster: MemoryCluster): Promise<string | null> {
  const memoryText = cluster.memories
    .map((m, i) => `${i + 1}. [${m.type}] ${m.content}`)
    .join("\n");

  const prompt = `These memories contain overlapping information. Merge them into a single concise memory that preserves all unique facts. Output only the merged text, nothing else.

Memories:
${memoryText}

Merged memory:`;

  const result = (await aiRun(ai, MERGE_MODEL, {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  })) as { response?: string };

  return result.response?.trim() || null;
}

/**
 * Write a merged memory to D1 and delete the originals.
 * Returns the new memory ID, or null if nothing was written.
 */
export async function writeMergedMemory(
  db: DbHandle,
  cluster: MemoryCluster,
  mergedContent: string,
): Promise<string | null> {
  const source = cluster.memories[0];
  const id = generateId();
  const ts = now();

  // Preserve highest importance and collect source IDs in metadata
  const maxImportance = Math.max(...cluster.memories.map((m) => m.importance));
  const sourceIds = cluster.memories.map((m) => m.id);
  const meta = toJson({ merged_from: sourceIds, merged_at: ts });

  // Insert merged memory
  await withRetry(() =>
    db
      .prepare(
        `INSERT INTO memories (id, namespace_id, content, type, source, importance, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, source.namespace_id, mergedContent, source.type, "merge", maxImportance, meta)
      .run(),
  );

  // Copy entity links from all originals to the merged memory
  await withRetry(() =>
    db
      .prepare(
        `INSERT OR IGNORE INTO memory_entity_links (memory_id, entity_id)
         SELECT ?, entity_id FROM memory_entity_links
         WHERE memory_id IN (${sourceIds.map(() => "?").join(",")})`,
      )
      .bind(id, ...sourceIds)
      .run(),
  );

  // Delete originals
  const placeholders = sourceIds.map(() => "?").join(",");
  await withRetry(() =>
    db
      .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
      .bind(...sourceIds)
      .run(),
  );

  return id;
}
