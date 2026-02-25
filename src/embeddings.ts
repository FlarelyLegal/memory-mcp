/**
 * Semantic search via Vectorize + Workers AI embeddings.
 *
 * Embeds entities and memories into a shared Vectorize index with metadata
 * to distinguish types and namespaces. This enables "what do I know about X?"
 * style queries across the entire memory graph.
 */
import type { Env } from "./types.js";

const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";

/**
 * Generate an embedding vector for the given text using Workers AI.
 */
export async function embed(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, { text: [text] }) as { data: number[][] };
  return result.data[0];
}

/**
 * Upsert a vector for an entity into Vectorize.
 */
export async function upsertEntityVector(
  env: Env,
  opts: {
    entity_id: string;
    namespace_id: string;
    name: string;
    type: string;
    summary: string | null;
  },
): Promise<void> {
  const textToEmbed = [opts.name, opts.type, opts.summary].filter(Boolean).join(" | ");
  const vector = await embed(env.AI, textToEmbed);

  await env.VECTORIZE.upsert([
    {
      id: `entity:${opts.entity_id}`,
      values: vector,
      metadata: {
        kind: "entity",
        entity_id: opts.entity_id,
        namespace_id: opts.namespace_id,
        name: opts.name,
        type: opts.type,
      },
    },
  ]);
}

/**
 * Upsert a vector for a memory into Vectorize.
 */
export async function upsertMemoryVector(
  env: Env,
  opts: {
    memory_id: string;
    namespace_id: string;
    content: string;
    type: string;
  },
): Promise<void> {
  const vector = await embed(env.AI, opts.content);

  await env.VECTORIZE.upsert([
    {
      id: `memory:${opts.memory_id}`,
      values: vector,
      metadata: {
        kind: "memory",
        memory_id: opts.memory_id,
        namespace_id: opts.namespace_id,
        type: opts.type,
      },
    },
  ]);
}

/**
 * Upsert a vector for a conversation message into Vectorize.
 */
export async function upsertMessageVector(
  env: Env,
  opts: {
    message_id: string;
    conversation_id: string;
    namespace_id: string;
    content: string;
    role: string;
  },
): Promise<void> {
  const vector = await embed(env.AI, opts.content);

  await env.VECTORIZE.upsert([
    {
      id: `message:${opts.message_id}`,
      values: vector,
      metadata: {
        kind: "message",
        message_id: opts.message_id,
        conversation_id: opts.conversation_id,
        namespace_id: opts.namespace_id,
        role: opts.role,
      },
    },
  ]);
}

/**
 * Delete a vector by its prefixed ID.
 */
export async function deleteVector(env: Env, kind: string, id: string): Promise<void> {
  await env.VECTORIZE.deleteByIds([`${kind}:${id}`]);
}

export interface SemanticSearchResult {
  id: string;
  kind: "entity" | "memory" | "message";
  score: number;
  metadata: Record<string, string>;
}

/**
 * Semantic search across all memory types within a namespace.
 * Returns the most relevant entities, memories, and messages.
 */
export async function semanticSearch(
  env: Env,
  query: string,
  namespace_id: string,
  opts?: { kind?: "entity" | "memory" | "message"; limit?: number },
): Promise<SemanticSearchResult[]> {
  const queryVector = await embed(env.AI, query);

  const filter: VectorizeVectorMetadataFilter = { namespace_id };
  if (opts?.kind) {
    filter.kind = opts.kind;
  }

  const results = await env.VECTORIZE.query(queryVector, {
    topK: opts?.limit ?? 10,
    filter,
    returnMetadata: true,
  });

  return results.matches.map((match) => ({
    id: match.id,
    kind: (match.metadata?.kind as "entity" | "memory" | "message") ?? "entity",
    score: match.score,
    metadata: (match.metadata ?? {}) as Record<string, string>,
  }));
}
