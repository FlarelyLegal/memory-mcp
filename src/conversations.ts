/**
 * Conversation and message history operations.
 */
import type { ConversationRow, MessageRow } from "./types.js";
import { type DbHandle, withRetry, isReplayInsertConflict } from "./db.js";
import { generateId, now, toJson, ftsEscape, handleFtsError, escapeLike } from "./utils.js";

export async function createConversation(
  db: DbHandle,
  opts: { namespace_id: string; title?: string; metadata?: Record<string, unknown> },
): Promise<string> {
  const id = generateId();
  try {
    await withRetry(() =>
      db
        .prepare(
          `INSERT INTO conversations (id, namespace_id, title, metadata) VALUES (?, ?, ?, ?)`,
        )
        .bind(id, opts.namespace_id, opts.title ?? null, toJson(opts.metadata ?? null))
        .run(),
    );
  } catch (err) {
    if (!(await isReplayInsertConflict(db, "conversations", id, err))) throw err;
  }
  return id;
}

export async function getConversation(db: DbHandle, id: string): Promise<ConversationRow | null> {
  return db.prepare(`SELECT * FROM conversations WHERE id = ?`).bind(id).first<ConversationRow>();
}

export async function listConversations(
  db: DbHandle,
  namespace_id: string,
  opts?: { limit?: number; offset?: number },
): Promise<ConversationRow[]> {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  const result = await db
    .prepare(
      `SELECT * FROM conversations WHERE namespace_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(namespace_id, limit, offset)
    .all<ConversationRow>();
  return result.results;
}

export async function addMessage(
  db: DbHandle,
  opts: {
    conversation_id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = generateId();
  const ts = now();
  try {
    await withRetry(() =>
      db.batch([
        db
          .prepare(
            `INSERT INTO messages (id, conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            opts.conversation_id,
            opts.role,
            opts.content,
            toJson(opts.metadata ?? null),
            ts,
          ),
        db
          .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
          .bind(ts, opts.conversation_id),
      ]),
    );
  } catch (err) {
    if (!(await isReplayInsertConflict(db, "messages", id, err))) throw err;
  }

  return id;
}

export async function getMessages(
  db: DbHandle,
  conversation_id: string,
  opts?: { limit?: number; before?: number; offset?: number },
): Promise<MessageRow[]> {
  const clauses: string[] = ["conversation_id = ?"];
  const params: unknown[] = [conversation_id];

  if (opts?.before) {
    clauses.push("created_at < ?");
    params.push(opts.before);
  }

  const limit = opts?.limit ?? 50;
  params.push(limit, opts?.offset ?? 0);

  const sql =
    `SELECT * FROM messages WHERE ${clauses.join(" AND ")}` +
    ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<MessageRow>();
  // Return in chronological order
  return result.results.reverse();
}

export async function searchMessages(
  db: DbHandle,
  namespace_id: string,
  query: string,
  opts?: { limit?: number; offset?: number },
): Promise<(MessageRow & { conversation_title: string | null })[]> {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;

  // FTS5 path: BM25-ranked message search
  try {
    const ftsQuery = ftsEscape(query);
    const result = await db
      .prepare(
        `SELECT m.*, c.title as conversation_title, bm25(messages_fts) AS rank
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN messages_fts ON messages_fts.rowid = m.rowid
         WHERE c.namespace_id = ? AND messages_fts MATCH ?
         ORDER BY rank
         LIMIT ? OFFSET ?`,
      )
      .bind(namespace_id, ftsQuery, limit, offset)
      .all<MessageRow & { conversation_title: string | null }>();
    if (result.results.length > 0 || result.success) return result.results;
  } catch (err) {
    handleFtsError(err);
  }

  // Fallback: LIKE-based search
  const result = await db
    .prepare(
      `SELECT m.*, c.title as conversation_title
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.namespace_id = ? AND m.content LIKE ? ESCAPE '\\'
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(namespace_id, `%${escapeLike(query)}%`, limit, offset)
    .all<MessageRow & { conversation_title: string | null }>();
  return result.results;
}

/**
 * Collect prefixed vector IDs for all messages in a conversation.
 * Must be called BEFORE deleting the conversation since cascade removes messages.
 */
export async function collectConversationVectorIds(
  db: DbHandle,
  conversationId: string,
): Promise<string[]> {
  const result = await db
    .prepare(`SELECT id FROM messages WHERE conversation_id = ?`)
    .bind(conversationId)
    .all<{ id: string }>();
  return result.results.map((r) => `message:${r.id}`);
}

export async function deleteConversation(db: DbHandle, id: string): Promise<void> {
  await withRetry(() => db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(id).run());
}
