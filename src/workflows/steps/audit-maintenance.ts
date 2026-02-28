/**
 * Consolidation steps: R2 audit event consolidation and D1 audit log purge.
 *
 * - R2: merges individual event objects into daily NDJSON files
 * - D1: purges audit_logs rows older than 90 days (R2 archive retained)
 */
import type { WorkflowStep } from "cloudflare:workers";
import type { Env } from "../../types.js";
import { now } from "../../utils.js";
import { purgeAuditLogs, consolidateAuditR2 } from "../../audit.js";
import type { StepRetry } from "./types.js";

/** Merge individual R2 audit event objects into daily NDJSON files. */
export async function stepConsolidateAuditR2(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
): Promise<number> {
  return step.do("consolidate-audit-r2", retry, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const a = await consolidateAuditR2(env.STORAGE, today);
    const b = await consolidateAuditR2(env.STORAGE, yesterday);
    return a + b;
  });
}

/** Purge D1 audit logs older than 90 days. */
export async function stepPurgeAuditLogs(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
): Promise<number> {
  return step.do("purge-audit-logs", retry, async () => {
    const cutoff = now() - 90 * 86400;
    return purgeAuditLogs(env.DB, cutoff);
  });
}
