/**
 * Two-stage reranking via Workers AI bge-reranker-base.
 *
 * Cross-encoder reranker takes query + candidate texts and produces
 * fine-grained relevance scores. Much more precise than bi-encoder
 * cosine similarity alone, but slower — so we only rerank a small
 * candidate pool from the initial Vectorize ANN search.
 */

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

/**
 * Build display text for a Vectorize match so the reranker can score it.
 * For entities, we reconstruct from metadata. For memories and messages,
 * we batch-fetch content from D1.
 */
export async function hydrateTexts(
  db: D1Database,
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

  // Batch-fetch memory content
  if (memoryIds.length > 0) {
    const placeholders = memoryIds.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT id, content FROM memories WHERE id IN (${placeholders})`)
      .bind(...memoryIds.map((m) => m.id))
      .all<{ id: string; content: string }>();
    const contentMap = new Map(result.results.map((r) => [r.id, r.content]));
    for (const { idx, id } of memoryIds) {
      texts[idx] = contentMap.get(id) ?? texts[idx];
    }
  }

  // Batch-fetch message content
  if (messageIds.length > 0) {
    const placeholders = messageIds.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT id, content FROM messages WHERE id IN (${placeholders})`)
      .bind(...messageIds.map((m) => m.id))
      .all<{ id: string; content: string }>();
    const contentMap = new Map(result.results.map((r) => [r.id, r.content]));
    for (const { idx, id } of messageIds) {
      texts[idx] = contentMap.get(id) ?? texts[idx];
    }
  }

  return texts;
}
