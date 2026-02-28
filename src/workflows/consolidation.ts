/**
 * Consolidation Workflow -- durable memory maintenance pipeline.
 *
 * Steps:
 * 1. Expire grants/memberships: transition past-due rows to status='expired'
 * 2. Decay sweep: archive memories below relevance threshold
 * 3. Duplicate detection: remove exact-duplicate memories (namespace-scoped)
 * 4. Memory merge: cluster similar memories via embeddings, LLM-merge
 * 5. Entity summary refresh: re-summarize entities using linked memories + AI
 * 6. Purge: hard-delete archived memories older than 30 days
 * 7. Consolidate R2 audit: merge individual event objects into daily NDJSON
 * 8. Purge D1 audit logs older than 90 days
 *
 * Each step is a standalone module in `./steps/`. This orchestrator resolves
 * params, calls steps in order, and assembles the result.
 *
 * Triggered by the `consolidate_memory` MCP tool or POST /api/v1/admin/consolidate.
 */
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../types.js";
import { DEFAULT_DECAY_THRESHOLD } from "../consolidation.js";

import { stepExpireGrants } from "./steps/expire-grants.js";
import {
  stepDecaySweep,
  stepRemoveDuplicates,
  stepMergeMemories,
  stepPurgeArchived,
} from "./steps/memory-maintenance.js";
import { stepRefreshSummaries } from "./steps/entity-summaries.js";
import { stepConsolidateAuditR2, stepPurgeAuditLogs } from "./steps/audit-maintenance.js";

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
  grants_expired: number;
  members_expired: number;
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
    const { namespace_id, decay_threshold, skip_merge, merge_threshold, skip_summaries } =
      event.payload;
    const threshold = decay_threshold ?? DEFAULT_DECAY_THRESHOLD;
    const purgeDays = event.payload.purge_after_days ?? 30;

    const { grantsExpired, membersExpired } = await stepExpireGrants(this.env, step, STEP_RETRY);
    const archived = await stepDecaySweep(this.env, step, STEP_RETRY, namespace_id, threshold);
    const duplicatesRemoved = await stepRemoveDuplicates(this.env, step, STEP_RETRY, namespace_id);

    const memoriesMerged = skip_merge
      ? 0
      : await stepMergeMemories(this.env, step, STEP_RETRY, AI_STEP, namespace_id, merge_threshold);

    const summariesRefreshed = skip_summaries
      ? 0
      : await stepRefreshSummaries(this.env, step, STEP_RETRY, AI_STEP, namespace_id);

    const purged = await stepPurgeArchived(this.env, step, STEP_RETRY, namespace_id, purgeDays);
    const auditConsolidated = await stepConsolidateAuditR2(this.env, step, STEP_RETRY);
    const auditPurged = await stepPurgeAuditLogs(this.env, step, STEP_RETRY);

    return {
      grants_expired: grantsExpired,
      members_expired: membersExpired,
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
