/**
 * Consolidation step: refresh entity summaries using Workers AI.
 *
 * Finds entities with linked memories and regenerates their AI summaries.
 * Re-embeds updated summaries into Vectorize.
 */
import type { WorkflowStep } from "cloudflare:workers";
import type { Env } from "../../types.js";
import { generateEntitySummary } from "../../summaries.js";
import { upsertEntityVector } from "../../vectorize.js";
import type { StepRetry } from "./types.js";

export async function stepRefreshSummaries(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
  aiRetry: StepRetry,
  namespaceId: string,
): Promise<number> {
  const entityIds = await step.do("fetch-entities-for-summary", retry, async () => {
    const db = env.DB;
    const result = await db
      .prepare(
        `SELECT DISTINCT mel.entity_id FROM memory_entity_links mel
         JOIN entities e ON e.id = mel.entity_id
         WHERE e.namespace_id = ?
         LIMIT 50`,
      )
      .bind(namespaceId)
      .all<{ entity_id: string }>();
    return result.results.map((r) => r.entity_id);
  });

  let refreshed = 0;
  for (let i = 0; i < entityIds.length; i++) {
    const eid = entityIds[i];
    const ok = await step.do(`refresh-summary-${i}`, aiRetry, async () => {
      const db = env.DB;
      const result = await generateEntitySummary(db, env.AI, eid);
      if (!result) return false;
      await upsertEntityVector(env, {
        entity_id: eid,
        namespace_id: namespaceId,
        name: result.entity.name,
        type: result.entity.type,
        summary: result.summary,
        created_at: result.entity.created_at,
      });
      return true;
    });
    if (ok) refreshed++;
  }
  return refreshed;
}
