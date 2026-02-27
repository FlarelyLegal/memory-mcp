/**
 * Reindex Workflow — durable batch re-embedding of entities and memories.
 *
 * Replaces the inline reindex logic that runs inside a single Worker request
 * (and risks CPU/duration limits). Each chunk is a separate durable step with
 * automatic retries, so large namespaces can be reindexed reliably.
 *
 * Triggered by the `reindex_vectors` MCP tool or `POST /api/v1/admin/reindex`.
 */
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "../types.js";
import { REINDEX_BATCH_SIZE, chunks, reindexEntityChunk, reindexMemoryChunk } from "../reindex.js";
import type { ReindexEntityItem, ReindexMemoryItem } from "../reindex.js";

export interface ReindexParams {
  /** Namespace ID, or "all" to reindex all namespaces owned by the email. */
  namespace_id: string;
  /** Authenticated user email (for ownership queries when namespace_id="all"). */
  email: string;
}

export interface ReindexResult {
  entities: number;
  memories: number;
  errors: number;
}

/** Step retry config: 3 attempts, 5s exponential backoff, 2m timeout. */
const STEP_RETRY = {
  retries: { limit: 3, delay: 5000 as const, backoff: "exponential" as const },
  timeout: 120_000 as const,
};

export class ReindexWorkflow extends WorkflowEntrypoint<Env, ReindexParams> {
  async run(event: WorkflowEvent<ReindexParams>, step: WorkflowStep): Promise<ReindexResult> {
    const { namespace_id, email } = event.payload;

    // Step 1: Fetch all entities to reindex
    const entityItems = await step.do("fetch-entities", STEP_RETRY, async () => {
      const db = this.env.DB;
      const query =
        namespace_id === "all"
          ? "SELECT e.id, e.namespace_id, e.name, e.type, e.summary, e.created_at FROM entities e JOIN namespaces n ON n.id = e.namespace_id WHERE n.owner = ?"
          : "SELECT id, namespace_id, name, type, summary, created_at FROM entities WHERE namespace_id = ?";
      const result = await db
        .prepare(query)
        .bind(namespace_id === "all" ? email : namespace_id)
        .all<ReindexEntityItem>();
      return result.results;
    });

    // Step 2: Embed + upsert entity chunks
    const entityChunks = chunks(entityItems, REINDEX_BATCH_SIZE);
    let entityCount = 0;
    let errorCount = 0;

    for (let i = 0; i < entityChunks.length; i++) {
      const chunk = entityChunks[i];
      const result = await step.do(`embed-entities-${i}`, STEP_RETRY, async () => {
        try {
          const n = await reindexEntityChunk(this.env, chunk);
          return { count: n, errors: 0 };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("model not found")) throw new NonRetryableError(msg);
          throw e;
        }
      });
      entityCount += result.count;
      errorCount += result.errors;
    }

    // Step 3: Fetch all memories to reindex
    const memoryItems = await step.do("fetch-memories", STEP_RETRY, async () => {
      const db = this.env.DB;
      const query =
        namespace_id === "all"
          ? "SELECT m.id, m.namespace_id, m.content, m.type, m.created_at FROM memories m JOIN namespaces n ON n.id = m.namespace_id WHERE n.owner = ?"
          : "SELECT id, namespace_id, content, type, created_at FROM memories WHERE namespace_id = ?";
      const result = await db
        .prepare(query)
        .bind(namespace_id === "all" ? email : namespace_id)
        .all<ReindexMemoryItem>();
      return result.results;
    });

    // Step 4: Embed + upsert memory chunks
    const memoryChunks = chunks(memoryItems, REINDEX_BATCH_SIZE);
    let memoryCount = 0;

    for (let i = 0; i < memoryChunks.length; i++) {
      const chunk = memoryChunks[i];
      const result = await step.do(`embed-memories-${i}`, STEP_RETRY, async () => {
        try {
          const n = await reindexMemoryChunk(this.env, chunk);
          return { count: n, errors: 0 };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("model not found")) throw new NonRetryableError(msg);
          throw e;
        }
      });
      memoryCount += result.count;
      errorCount += result.errors;
    }

    return { entities: entityCount, memories: memoryCount, errors: errorCount };
  }
}
