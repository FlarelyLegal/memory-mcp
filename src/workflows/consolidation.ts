/**
 * Consolidation Workflow — durable memory maintenance pipeline.
 *
 * Steps:
 * 1. Decay sweep: archive memories below relevance threshold
 * 2. Duplicate detection: find exact-duplicate memories and delete extras
 * 3. Memory merge: cluster similar memories via embeddings, LLM-merge
 * 4. Entity summary refresh: re-summarize entities using linked memories + AI
 * 5. Purge: hard-delete archived memories older than 30 days
 * 6. Consolidate R2 audit: merge individual event objects into daily NDJSON
 * 7. Purge D1 audit logs older than 90 days
 *
 * Triggered by the `consolidate_memory` MCP tool or POST /api/v1/admin/consolidate.
 */
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../types.js";
import { now } from "../utils.js";

import {
  findDecayedMemories,
  archiveMemories,
  purgeArchivedMemories,
  findDuplicateMemories,
  DEFAULT_DECAY_THRESHOLD,
} from "../consolidation.js";
import { generateEntitySummary } from "../summaries.js";
import { purgeAuditLogs, consolidateAuditR2 } from "../audit.js";
import { deleteVector, upsertEntityVector, upsertMemoryVector } from "../vectorize.js";
import { findMemoryClusters, mergeCluster, writeMergedMemory } from "../merge.js";

export interface ConsolidationParams {
  namespace_id: string;
  email: string;
  /** Override decay threshold (default 0.15). */
  decay_threshold?: number;
  /** Skip memory merge (default false). */
  skip_merge?: boolean;
  /** Cosine similarity threshold for merge (default 0.85). */
  merge_threshold?: number;
  /** Skip entity summary refresh (default false). */
  skip_summaries?: boolean;
  /** Days before archived memories are purged (default 30). */
  purge_after_days?: number;
}

export interface ConsolidationResult {
  archived: number;
  duplicates_removed: number;
  memories_merged: number;
  summaries_refreshed: number;
  purged: number;
  audit_consolidated: number;
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
    const {
      namespace_id,
      decay_threshold,
      skip_merge,
      merge_threshold,
      skip_summaries,
      purge_after_days,
    } = event.payload;
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

    // Step 3: Memory merge — cluster similar memories and LLM-merge
    let memoriesMerged = 0;
    if (!skip_merge) {
      const clusters = await step.do("find-merge-clusters", STEP_RETRY, async () => {
        const db = this.env.DB;
        const found = await findMemoryClusters(db, this.env.AI, namespace_id, {
          threshold: merge_threshold,
        });
        // Serialize for durable step return (MemoryRow objects)
        return found.map((c) => ({ ids: c.memories.map((m) => m.id), memories: c.memories }));
      });

      for (let i = 0; i < clusters.length; i++) {
        const merged = await step.do(`merge-cluster-${i}`, AI_STEP, async () => {
          const db = this.env.DB;
          const cluster = clusters[i];
          const content = await mergeCluster(this.env.AI, { memories: cluster.memories });
          if (!content) return null;
          const newId = await writeMergedMemory(db, { memories: cluster.memories }, content);
          if (!newId) return null;
          // Re-embed merged memory
          const type = cluster.memories[0]?.type ?? "fact";
          await upsertMemoryVector(this.env, {
            memory_id: newId,
            namespace_id,
            content,
            type,
          });
          // Delete vectors for originals
          for (const id of cluster.ids) {
            try {
              await deleteVector(this.env, "memory", id);
            } catch {
              /* best-effort */
            }
          }
          return cluster.ids.length;
        });
        if (merged) memoriesMerged += merged;
      }
    }

    // Step 4: Entity summary refresh using Workers AI
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
          const result = await generateEntitySummary(db, this.env.AI, eid);
          if (!result) return false;
          await upsertEntityVector(this.env, {
            entity_id: eid,
            namespace_id,
            name: result.entity.name,
            type: result.entity.type,
            summary: result.summary,
            created_at: result.entity.created_at,
          });
          return true;
        });
        if (refreshed) summariesRefreshed++;
      }
    }

    // Step 5: Purge archived memories older than N days
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

    // Step 6: Consolidate R2 audit events into daily NDJSON files
    const auditConsolidated = await step.do("consolidate-audit-r2", STEP_RETRY, async () => {
      // Consolidate today and yesterday (covers events near midnight)
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
      const a = await consolidateAuditR2(this.env.STORAGE, today);
      const b = await consolidateAuditR2(this.env.STORAGE, yesterday);
      return a + b;
    });

    // Step 7: Purge old audit logs from D1 (R2 archive is retained)
    const auditPurged = await step.do("purge-audit-logs", STEP_RETRY, async () => {
      const db = this.env.DB;
      const cutoff = now() - 90 * 86400; // 90 days
      return purgeAuditLogs(db, cutoff);
    });

    return {
      archived,
      duplicates_removed: duplicatesRemoved,
      memories_merged: memoriesMerged,
      summaries_refreshed: summariesRefreshed,
      purged,
      audit_consolidated: auditConsolidated,
      audit_purged: auditPurged,
    };
  }
}
