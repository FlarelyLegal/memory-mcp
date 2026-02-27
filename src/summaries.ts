/**
 * Entity summary generation via Workers AI.
 *
 * Fetches an entity and its linked memories, then uses an LLM to produce
 * a concise 1-2 sentence summary. Used by the consolidation workflow.
 */
import type { MemoryRow, EntityRow } from "./types.js";
import type { DbHandle } from "./db.js";
import { withRetry } from "./db.js";
import { now } from "./utils.js";
import { aiRun } from "./ai.js";

/** LLM model for entity summary generation (free tier, 128K context). */
const SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

/** Fetch entity + its linked memories for LLM-based summary generation. */
export async function getEntityWithMemories(
  db: DbHandle,
  entity_id: string,
): Promise<{ entity: EntityRow; memories: MemoryRow[] } | null> {
  const entity = await db
    .prepare("SELECT * FROM entities WHERE id = ?")
    .bind(entity_id)
    .first<EntityRow>();
  if (!entity) return null;

  const mems = await db
    .prepare(
      `SELECT m.* FROM memories m
       JOIN memory_entity_links mel ON mel.memory_id = m.id
       WHERE mel.entity_id = ?
       ORDER BY m.importance DESC LIMIT 20`,
    )
    .bind(entity_id)
    .all<MemoryRow>();
  return { entity, memories: mems.results };
}

/** Update an entity's summary field. */
export async function updateEntitySummary(
  db: DbHandle,
  entity_id: string,
  summary: string,
): Promise<void> {
  await withRetry(() =>
    db
      .prepare("UPDATE entities SET summary = ?, updated_at = ? WHERE id = ?")
      .bind(summary, now(), entity_id)
      .run(),
  );
}

/**
 * Generate a new entity summary from its linked memories via Workers AI.
 * Returns the summary string and entity data, or null if no memories or LLM fails.
 */
export async function generateEntitySummary(
  db: DbHandle,
  ai: Ai,
  entity_id: string,
): Promise<{ summary: string; entity: EntityRow } | null> {
  const data = await getEntityWithMemories(db, entity_id);
  if (!data || data.memories.length === 0) return null;

  const memoryText = data.memories
    .slice(0, 10)
    .map((m) => `- [${m.type}] ${m.content}`)
    .join("\n");

  const prompt = `Summarize this entity in 1-2 sentences based on the associated memories.

Entity: ${data.entity.name} (${data.entity.type})
Current summary: ${data.entity.summary ?? "none"}

Associated memories:
${memoryText}

Write a concise, factual summary:`;

  const result = (await aiRun(ai, SUMMARY_MODEL, {
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
  })) as { response?: string };

  const summary = result.response?.trim();
  if (!summary) return null;

  await updateEntitySummary(db, entity_id, summary);
  return { summary, entity: data.entity };
}
