/**
 * Two-stage reranking via Workers AI bge-reranker-base.
 *
 * Cross-encoder reranker takes query + candidate texts and produces
 * fine-grained relevance scores. Much more precise than bi-encoder
 * cosine similarity alone, but slower — so we only rerank a small
 * candidate pool from the initial Vectorize ANN search.
 */

import type { DbHandle } from "./db.js";

const RERANKER_MODEL = "@cf/baai/bge-reranker-base";

interface RerankerInput {
  query: string;
  contexts: { text: string }[];
}

interface RerankerOutput {
  response: { id: number; score: number }[];
}

/**
 * Rerank candidate texts against a query using bge-reranker-base.
 * Returns scores indexed by original position. Falls back to null
 * when the AI binding is unavailable (local dev).
 */
export async function rerank(
  ai: Ai,
  query: string,
  texts: string[],
): Promise<{ id: number; score: number }[] | null> {
  if (!ai || texts.length === 0) return null;
  try {
    const input: RerankerInput = {
      query,
      contexts: texts.map((text) => ({ text })),
    };
    const result = (await ai.run(RERANKER_MODEL, input)) as RerankerOutput;
    return result.response;
  } catch {
    // AI binding unavailable (local dev) — skip reranking
    return null;
  }
}

/** D1 max bound parameters per query. */
const MAX_PARAMS = 100;

/**
 * Build display text for a Vectorize match so the reranker can score it.
 * For entities, we reconstruct from metadata. For memories and messages,
 * we batch-fetch content from D1 (chunked at 100 for D1 param limit).
 */
export async function hydrateTexts(
  db: DbHandle,
  matches: VectorizeMatches["matches"],
): Promise<string[]> {
  // Pre-allocate with metadata-based text
  const texts: string[] = matches.map((m) => {
    const meta = m.metadata ?? {};
    if (meta.kind === "entity") {
      return [meta.name, meta.type].filter(Boolean).join(" | ");
    }
    // Memories and messages: placeholder — will be replaced from D1
    return String(meta.kind ?? "");
  });

  // Collect IDs that need D1 hydration
  const memoryIds: { idx: number; id: string }[] = [];
  const messageIds: { idx: number; id: string }[] = [];

  for (let i = 0; i < matches.length; i++) {
    const meta = matches[i].metadata ?? {};
    if (meta.kind === "memory" && meta.memory_id) {
      memoryIds.push({ idx: i, id: String(meta.memory_id) });
    } else if (meta.kind === "message" && meta.message_id) {
      messageIds.push({ idx: i, id: String(meta.message_id) });
    }
  }

  // Batch-fetch memory content (chunked for D1 param limit)
  await batchHydrate(db, "memories", memoryIds, texts);
  // Batch-fetch message content (chunked for D1 param limit)
  await batchHydrate(db, "messages", messageIds, texts);

  return texts;
}

/** Fetch content from a table in chunks of MAX_PARAMS and fill `texts`. */
async function batchHydrate(
  db: DbHandle,
  table: string,
  entries: { idx: number; id: string }[],
  texts: string[],
): Promise<void> {
  if (entries.length === 0) return;
  for (let i = 0; i < entries.length; i += MAX_PARAMS) {
    const chunk = entries.slice(i, i + MAX_PARAMS);
    const ph = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT id, content FROM ${table} WHERE id IN (${ph})`)
      .bind(...chunk.map((c) => c.id))
      .all<{ id: string; content: string }>();
    const contentMap = new Map(result.results.map((r) => [r.id, r.content]));
    for (const { idx, id } of chunk) {
      texts[idx] = contentMap.get(id) ?? texts[idx];
    }
  }
}
