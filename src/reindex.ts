/** Shared batch-reindex logic for entities and memories into Vectorize. */
import type { Env } from "./types.js";
import { embedBatch } from "./embeddings.js";

/** Items per Workers AI + Vectorize batch. Keeps each call well within limits. */
export const REINDEX_BATCH_SIZE = 25;

export interface ReindexEntityItem {
  id: string;
  namespace_id: string;
  name: string;
  type: string;
  summary: string | null;
}

export interface ReindexMemoryItem {
  id: string;
  namespace_id: string;
  content: string;
  type: string;
}

export interface ReindexResult {
  entities: number;
  memories: number;
  errors: number;
}

/** Split an array into chunks of the given size. */
export function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/** Batch-embed and upsert a chunk of entities into Vectorize. Returns count embedded. */
export async function reindexEntityChunk(env: Env, chunk: ReindexEntityItem[]): Promise<number> {
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
  return chunk.length;
}

/** Batch-embed and upsert a chunk of memories into Vectorize. Returns count embedded. */
export async function reindexMemoryChunk(env: Env, chunk: ReindexMemoryItem[]): Promise<number> {
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
  return chunk.length;
}
