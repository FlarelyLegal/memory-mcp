/**
 * Consolidation Workflow — durable memory maintenance pipeline.
 *
 * Steps:
 * 1. Decay sweep: archive memories below relevance threshold
 * 2. Duplicate detection: find exact-duplicate memories and delete extras
 * 3. Entity summary refresh: re-summarize entities using linked memories + AI
 * 4. Purge: hard-delete archived memories older than 30 days
 *
 * Triggered by the `consolidate_memory` MCP tool or POST /api/v1/admin/consolidate.
 */
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../types.js";
import { now } from "../utils.js";

/**
 * LLM for entity summary generation. Uses llama-3.1-8b-instruct-fp8:
 * - Free tier (no per-token cost)
 * - 128K context (more than enough for our prompts)
 * - In @cloudflare/workers-types (no type cast needed)
 * - Good enough quality for 1-2 sentence summaries
 */
const SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

import {
  findDecayedMemories,
  archiveMemories,
  purgeArchivedMemories,
  findDuplicateMemories,
  getEntityWithMemories,
  updateEntitySummary,
  DEFAULT_DECAY_THRESHOLD,
} from "../consolidation.js";
import { purgeAuditLogs } from "../audit.js";
import { deleteVector } from "../vectorize.js";
import { upsertEntityVector } from "../vectorize.js";

export interface ConsolidationParams {
  namespace_id: string;
  email: string;
  /** Override decay threshold (default 0.15). */
  decay_threshold?: number;
  /** Skip entity summary refresh (default false). */
  skip_summaries?: boolean;
  /** Days before archived memories are purged (default 30). */
  purge_after_days?: number;
}

export interface ConsolidationResult {
  archived: number;
  duplicates_removed: number;
  summaries_refreshed: number;
  purged: number;
  audit_purged: number;
}

const STEP_RETRY = {
  retries: { limit: 3, delay: 5000 as const, backoff: "exponential" as const },
  timeout: 120_000 as const,
};

const AI_STEP = {
  retries: { limit: 2, delay: 10_000 as const, backoff: "exponential" as const },
  timeout: 60_000 as const,
};

export class ConsolidationWorkflow extends WorkflowEntrypoint<Env, ConsolidationParams> {
  async run(
    event: WorkflowEvent<ConsolidationParams>,
    step: WorkflowStep,
  ): Promise<ConsolidationResult> {
    const { namespace_id, decay_threshold, skip_summaries, purge_after_days } = event.payload;
    const threshold = decay_threshold ?? DEFAULT_DECAY_THRESHOLD;
    const purgeDays = purge_after_days ?? 30;

    // Step 1: Decay sweep — find and archive low-relevance memories
    const archived = await step.do("decay-sweep", STEP_RETRY, async () => {
      const db = this.env.DB;
      const decayed = await findDecayedMemories(db, namespace_id, { threshold });
      if (decayed.length === 0) return 0;
      const ids = decayed.map((m) => m.id);
      return archiveMemories(db, ids);
    });

    // Step 2: Duplicate detection — remove exact duplicates
    const duplicatesRemoved = await step.do("remove-duplicates", STEP_RETRY, async () => {
      const db = this.env.DB;
      const dupes = await findDuplicateMemories(db, namespace_id);
      if (dupes.length === 0) return 0;
      // Keep the first (id_a), delete the second (id_b)
      const toDelete = dupes.map((d) => d.id_b);
      const stmt = db.prepare("DELETE FROM memories WHERE id = ?");
      const results = await db.batch(toDelete.map((id) => stmt.bind(id)));
      const deleted = results.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
      // Clean up vectors for deleted memories
      for (const id of toDelete) {
        try {
          await deleteVector(this.env, "memory", id);
        } catch {
          // best-effort vector cleanup
        }
      }
      return deleted;
    });

    // Step 3: Entity summary refresh using Workers AI
    let summariesRefreshed = 0;
    if (!skip_summaries) {
      // Fetch entity IDs that have linked memories
      const entityIds = await step.do("fetch-entities-for-summary", STEP_RETRY, async () => {
        const db = this.env.DB;
        const result = await db
          .prepare(
            `SELECT DISTINCT mel.entity_id FROM memory_entity_links mel
             JOIN entities e ON e.id = mel.entity_id
             WHERE e.namespace_id = ?
             LIMIT 50`,
          )
          .bind(namespace_id)
          .all<{ entity_id: string }>();
        return result.results.map((r) => r.entity_id);
      });

      for (let i = 0; i < entityIds.length; i++) {
        const eid = entityIds[i];
        const refreshed = await step.do(`refresh-summary-${i}`, AI_STEP, async () => {
          const db = this.env.DB;
          const data = await getEntityWithMemories(db, eid);
          if (!data || data.memories.length === 0) return false;

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

          const result = (await this.env.AI.run(SUMMARY_MODEL, {
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150,
          })) as { response?: string };

          const summary = result.response?.trim();
          if (!summary) return false;

          await updateEntitySummary(db, eid, summary);
          // Re-embed the entity with updated summary
          await upsertEntityVector(this.env, {
            entity_id: eid,
            namespace_id,
            name: data.entity.name,
            type: data.entity.type,
            summary,
            created_at: data.entity.created_at,
          });
          return true;
        });
        if (refreshed) summariesRefreshed++;
      }
    }

    // Step 4: Purge archived memories older than N days
    const purged = await step.do("purge-archived", STEP_RETRY, async () => {
      const db = this.env.DB;
      const cutoff = now() - purgeDays * 86400;
      const result = await purgeArchivedMemories(db, namespace_id, cutoff);
      // Keep Vectorize in sync with hard-deleted memories.
      for (const id of result.deleted_ids) {
        try {
          await deleteVector(this.env, "memory", id);
        } catch {
          // best-effort vector cleanup
        }
      }
      return result.deleted;
    });

    // Step 5: Purge old audit logs from D1 (R2 archive is retained)
    const auditPurged = await step.do("purge-audit-logs", STEP_RETRY, async () => {
      const db = this.env.DB;
      const cutoff = now() - 90 * 86400; // 90 days
      return purgeAuditLogs(db, cutoff);
    });

    return {
      archived,
      duplicates_removed: duplicatesRemoved,
      summaries_refreshed: summariesRefreshed,
      purged,
      audit_purged: auditPurged,
    };
  }
}
