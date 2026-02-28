/**
 * Consolidation steps: memory decay sweep, dedup, merge, and purge.
 *
 * All operations are namespace-scoped. Dedup uses exact content match
 * within a single namespace -- no cross-namespace comparison.
 */
import type { WorkflowStep } from "cloudflare:workers";
import type { Env } from "../../types.js";
import { now } from "../../utils.js";
import {
  findDecayedMemories,
  archiveMemories,
  purgeArchivedMemories,
  findDuplicateMemories,
} from "../../consolidation.js";
import { deleteVector, upsertMemoryVector } from "../../vectorize.js";
import { findMemoryClusters, mergeCluster, writeMergedMemory } from "../../merge.js";
import type { StepRetry } from "./types.js";

/** Archive memories whose decay-ranked relevance is below threshold. */
export async function stepDecaySweep(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
  namespaceId: string,
  threshold: number,
): Promise<number> {
  return step.do("decay-sweep", retry, async () => {
    const db = env.DB;
    const decayed = await findDecayedMemories(db, namespaceId, { threshold });
    if (decayed.length === 0) return 0;
    return archiveMemories(
      db,
      decayed.map((m) => m.id),
    );
  });
}

/** Remove exact-duplicate memories (same content within namespace). */
export async function stepRemoveDuplicates(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
  namespaceId: string,
): Promise<number> {
  return step.do("remove-duplicates", retry, async () => {
    const db = env.DB;
    const dupes = await findDuplicateMemories(db, namespaceId);
    if (dupes.length === 0) return 0;
    const toDelete = dupes.map((d) => d.id_b);
    const stmt = db.prepare("DELETE FROM memories WHERE id = ?");
    const results = await db.batch(toDelete.map((id) => stmt.bind(id)));
    const deleted = results.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
    for (const id of toDelete) {
      try {
        await deleteVector(env, "memory", id);
      } catch {
        /* best-effort vector cleanup */
      }
    }
    return deleted;
  });
}

/** Cluster similar memories via embeddings, then LLM-merge each cluster. */
export async function stepMergeMemories(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
  aiRetry: StepRetry,
  namespaceId: string,
  mergeThreshold?: number,
): Promise<number> {
  const clusters = await step.do("find-merge-clusters", retry, async () => {
    const db = env.DB;
    const found = await findMemoryClusters(db, env.AI, namespaceId, {
      threshold: mergeThreshold,
    });
    return found.map((c) => ({ ids: c.memories.map((m) => m.id), memories: c.memories }));
  });

  let merged = 0;
  for (let i = 0; i < clusters.length; i++) {
    const count = await step.do(`merge-cluster-${i}`, aiRetry, async () => {
      const db = env.DB;
      const cluster = clusters[i];
      const content = await mergeCluster(env.AI, { memories: cluster.memories });
      if (!content) return null;
      const newId = await writeMergedMemory(db, { memories: cluster.memories }, content);
      if (!newId) return null;
      const type = cluster.memories[0]?.type ?? "fact";
      await upsertMemoryVector(env, { memory_id: newId, namespace_id: namespaceId, content, type });
      for (const id of cluster.ids) {
        try {
          await deleteVector(env, "memory", id);
        } catch {
          /* best-effort */
        }
      }
      return cluster.ids.length;
    });
    if (count) merged += count;
  }
  return merged;
}

/** Hard-delete archived memories older than cutoff. */
export async function stepPurgeArchived(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
  namespaceId: string,
  purgeDays: number,
): Promise<number> {
  return step.do("purge-archived", retry, async () => {
    const db = env.DB;
    const cutoff = now() - purgeDays * 86400;
    const result = await purgeArchivedMemories(db, namespaceId, cutoff);
    for (const id of result.deleted_ids) {
      try {
        await deleteVector(env, "memory", id);
      } catch {
        /* best-effort vector cleanup */
      }
    }
    return result.deleted;
  });
}
