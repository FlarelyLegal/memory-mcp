/**
 * Conversation and message history operations.
 */
import type { ConversationRow, MessageRow } from "./types.js";
import { generateId, now, toJson } from "./utils.js";

export async function createConversation(
  db: D1Database,
  opts: { namespace_id: string; title?: string; metadata?: Record<string, unknown> },
): Promise<string> {
  const id = generateId();
  await db
    .prepare(`INSERT INTO conversations (id, namespace_id, title, metadata) VALUES (?, ?, ?, ?)`)
    .bind(id, opts.namespace_id, opts.title ?? null, toJson(opts.metadata ?? null))
    .run();
  return id;
}

export async function getConversation(db: D1Database, id: string): Promise<ConversationRow | null> {
  return db.prepare(`SELECT * FROM conversations WHERE id = ?`).bind(id).first<ConversationRow>();
}

export async function listConversations(
  db: D1Database,
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
  db: D1Database,
  opts: {
    conversation_id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = generateId();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO messages (id, conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, opts.conversation_id, opts.role, opts.content, toJson(opts.metadata ?? null), ts)
    .run();

  // Update conversation timestamp
  await db
    .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
    .bind(ts, opts.conversation_id)
    .run();

  return id;
}

export async function getMessages(
  db: D1Database,
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
  db: D1Database,
  namespace_id: string,
  query: string,
  opts?: { limit?: number; offset?: number },
): Promise<(MessageRow & { conversation_title: string | null })[]> {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  const result = await db
    .prepare(
      `SELECT m.*, c.title as conversation_title
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.namespace_id = ? AND m.content LIKE ?
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(namespace_id, `%${query}%`, limit, offset)
    .all<MessageRow & { conversation_title: string | null }>();
  return result.results;
}

export async function deleteConversation(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(id).run();
}
