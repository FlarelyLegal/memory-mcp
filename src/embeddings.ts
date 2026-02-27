/**
 * Workers AI embedding generation.
 *
 * Thin wrapper around the bge-large-en-v1.5 embedding model.
 * Used by vectorize.ts for vector CRUD and reindex.ts for batch operations.
 */

const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";

/** Generate an embedding vector for the given text using Workers AI. */
export async function embed(ai: Ai, text: string): Promise<number[]> {
  const result = (await ai.run(EMBEDDING_MODEL, { text: [text] })) as { data: number[][] };
  return result.data[0];
}

/**
 * Generate embedding vectors for multiple texts in a single Workers AI call.
 * Much more efficient than calling embed() in a loop.
 */
export async function embedBatch(ai: Ai, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const result = (await ai.run(EMBEDDING_MODEL, { text: texts })) as { data: number[][] };
  return result.data;
}
