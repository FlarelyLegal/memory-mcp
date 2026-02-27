/**
 * Reindex Workflow — durable batch re-embedding of entities, memories, and messages.
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
import {
  REINDEX_BATCH_SIZE,
  chunks,
  reindexEntityChunk,
  reindexMemoryChunk,
  reindexMessageChunk,
} from "../reindex.js";
import type { ReindexEntityItem, ReindexMemoryItem, ReindexMessageItem } from "../reindex.js";

export interface ReindexParams {
  /** Namespace ID, or "all" to reindex all namespaces owned by the email. */
  namespace_id: string;
  /** Authenticated user email (for ownership queries when namespace_id="all"). */
  email: string;
}

export interface ReindexResult {
  entities: number;
  memories: number;
  messages: number;
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
    const bind = namespace_id === "all" ? email : namespace_id;
    let errorCount = 0;

    /** Embed + upsert items in chunked workflow steps. */
    const embedChunks = async <T>(
      label: string,
      items: T[],
      fn: (env: Env, chunk: T[]) => Promise<number>,
    ): Promise<number> => {
      let count = 0;
      for (const [i, chunk] of chunks(items, REINDEX_BATCH_SIZE).entries()) {
        const result = await step.do(`embed-${label}-${i}`, STEP_RETRY, async () => {
          try {
            return { count: await fn(this.env, chunk), errors: 0 };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("model not found")) throw new NonRetryableError(msg);
            throw e;
          }
        });
        count += result.count;
        errorCount += result.errors;
      }
      return count;
    };

    // Step 1: Fetch + embed entities
    const entityItems = await step.do("fetch-entities", STEP_RETRY, async () => {
      const q =
        namespace_id === "all"
          ? "SELECT e.id, e.namespace_id, e.name, e.type, e.summary, e.created_at FROM entities e JOIN namespaces n ON n.id = e.namespace_id WHERE n.owner = ?"
          : "SELECT id, namespace_id, name, type, summary, created_at FROM entities WHERE namespace_id = ?";
      return (await this.env.DB.prepare(q).bind(bind).all<ReindexEntityItem>()).results;
    });
    const entityCount = await embedChunks("entities", entityItems, reindexEntityChunk);

    // Step 2: Fetch + embed memories
    const memoryItems = await step.do("fetch-memories", STEP_RETRY, async () => {
      const q =
        namespace_id === "all"
          ? "SELECT m.id, m.namespace_id, m.content, m.type, m.created_at FROM memories m JOIN namespaces n ON n.id = m.namespace_id WHERE n.owner = ?"
          : "SELECT id, namespace_id, content, type, created_at FROM memories WHERE namespace_id = ?";
      return (await this.env.DB.prepare(q).bind(bind).all<ReindexMemoryItem>()).results;
    });
    const memoryCount = await embedChunks("memories", memoryItems, reindexMemoryChunk);

    // Step 3: Fetch + embed messages (join through conversations for namespace)
    const messageItems = await step.do("fetch-messages", STEP_RETRY, async () => {
      const q =
        namespace_id === "all"
          ? `SELECT m.id, m.conversation_id, c.namespace_id, m.content, m.role, m.created_at
             FROM messages m JOIN conversations c ON c.id = m.conversation_id
             JOIN namespaces n ON n.id = c.namespace_id WHERE n.owner = ?`
          : `SELECT m.id, m.conversation_id, c.namespace_id, m.content, m.role, m.created_at
             FROM messages m JOIN conversations c ON c.id = m.conversation_id
             WHERE c.namespace_id = ?`;
      return (await this.env.DB.prepare(q).bind(bind).all<ReindexMessageItem>()).results;
    });
    const messageCount = await embedChunks("messages", messageItems, reindexMessageChunk);

    return {
      entities: entityCount,
      memories: memoryCount,
      messages: messageCount,
      errors: errorCount,
    };
  }
}
