/**
 * Vectorize CRUD and two-stage semantic search.
 *
 * Manages vector storage (upsert/delete) and orchestrates the search pipeline:
 * 1. Vectorize ANN search (bi-encoder, fast) over-fetches 3x candidates
 * 2. bge-reranker-base (cross-encoder, precise) re-scores and returns top N
 */
import type { Env } from "./types.js";
import type { DbHandle } from "./db.js";
import { embed } from "./embeddings.js";
import { rerank, hydrateTexts } from "./reranker.js";
import { now } from "./utils.js";

/** Over-fetch multiplier for the reranker candidate pool. */
const RERANK_POOL_MULTIPLIER = 3;

// ---------------------------------------------------------------------------
// Vector CRUD
// ---------------------------------------------------------------------------

/** Upsert a vector for an entity into Vectorize. */
export async function upsertEntityVector(
  env: Env,
  opts: {
    entity_id: string;
    namespace_id: string;
    name: string;
    type: string;
    summary: string | null;
    created_at?: number;
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
        created_at: opts.created_at ?? now(),
      },
    },
  ]);
}

/** Upsert a vector for a memory into Vectorize. */
export async function upsertMemoryVector(
  env: Env,
  opts: {
    memory_id: string;
    namespace_id: string;
    content: string;
    type: string;
    created_at?: number;
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
        created_at: opts.created_at ?? now(),
      },
    },
  ]);
}

/** Upsert a vector for a conversation message into Vectorize. */
export async function upsertMessageVector(
  env: Env,
  opts: {
    message_id: string;
    conversation_id: string;
    namespace_id: string;
    content: string;
    role: string;
    created_at?: number;
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
        created_at: opts.created_at ?? now(),
      },
    },
  ]);
}

/** Delete a vector by its prefixed ID. */
export async function deleteVector(env: Env, kind: string, id: string): Promise<void> {
  await env.VECTORIZE.deleteByIds([`${kind}:${id}`]);
}

// ---------------------------------------------------------------------------
// Semantic search
// ---------------------------------------------------------------------------

export interface SemanticSearchResult {
  id: string;
  kind: "entity" | "memory" | "message";
  score: number;
  metadata: Record<string, string>;
}

/**
 * Two-stage semantic search across all memory types within a namespace.
 *
 * Stage 1: Vectorize ANN search (bi-encoder) over-fetches 3x candidates.
 * Stage 2: bge-reranker-base (cross-encoder) re-scores candidates and
 *          returns the top N with the reranker's relevance score.
 *
 * Falls back to single-stage Vectorize results when AI is unavailable.
 */
export async function semanticSearch(
  env: Env,
  db: DbHandle,
  query: string,
  namespace_id: string,
  opts?: {
    kind?: "entity" | "memory" | "message";
    type?: string;
    after?: number;
    before?: number;
    role?: string;
    conversation_id?: string;
    limit?: number;
  },
): Promise<SemanticSearchResult[]> {
  const desiredLimit = opts?.limit ?? 10;
  // Over-fetch for reranking (capped at Vectorize max topK of 20 with metadata)
  const fetchLimit = Math.min(desiredLimit * RERANK_POOL_MULTIPLIER, 20);

  const queryVector = await embed(env.AI, query);

  const filter: VectorizeVectorMetadataFilter = { namespace_id };
  if (opts?.kind) {
    filter.kind = opts.kind;
  }
  if (opts?.type) {
    filter.type = opts.type;
  }
  if (opts?.role) {
    filter.role = opts.role;
  }
  if (opts?.conversation_id) {
    filter.conversation_id = opts.conversation_id;
  }
  // Time-bounded search via created_at range filters
  if (opts?.after !== undefined || opts?.before !== undefined) {
    const range: Record<string, number> = {};
    if (opts?.after !== undefined) range["$gte"] = opts.after;
    if (opts?.before !== undefined) range["$lt"] = opts.before;
    filter.created_at = range;
  }

  const results = await env.VECTORIZE.query(queryVector, {
    topK: fetchLimit,
    filter,
    returnMetadata: true,
  });

  const candidates = results.matches;
  if (candidates.length === 0) return [];

  // Stage 2: Rerank with cross-encoder
  const texts = await hydrateTexts(db, candidates);
  const reranked = await rerank(env.AI, query, texts);

  if (reranked) {
    // Sort by reranker score (descending) and take top N
    const sorted = reranked
      .map((r) => ({
        match: candidates[r.id],
        score: r.score,
      }))
      .filter((r) => r.match) // guard against index mismatch
      .sort((a, b) => b.score - a.score)
      .slice(0, desiredLimit);

    return sorted.map((r) => ({
      id: r.match.id,
      kind: (r.match.metadata?.kind as "entity" | "memory" | "message") ?? "entity",
      score: r.score,
      metadata: (r.match.metadata ?? {}) as Record<string, string>,
    }));
  }

  // Fallback: return Vectorize results directly (local dev / AI unavailable)
  return candidates.slice(0, desiredLimit).map((match) => ({
    id: match.id,
    kind: (match.metadata?.kind as "entity" | "memory" | "message") ?? "entity",
    score: match.score,
    metadata: (match.metadata ?? {}) as Record<string, string>,
  }));
}
