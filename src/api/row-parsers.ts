/** Shared row-parsing helpers for converting DB rows to API responses. */
import { parseJson, toISO } from "../utils.js";
import type {
  EntityRow,
  MemoryRow,
  RelationRow,
  ConversationRow,
  MessageRow,
  NamespaceRow,
} from "../types.js";

/** Parse an entity row: JSON metadata + ISO 8601 timestamps. */
export function parseEntityRow(row: EntityRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    created_at: toISO(row.created_at),
    updated_at: toISO(row.updated_at),
    last_accessed_at: toISO(row.last_accessed_at),
  };
}

/** Parse a memory row: JSON metadata + ISO 8601 timestamps. */
export function parseMemoryRow(row: MemoryRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    created_at: toISO(row.created_at),
    updated_at: toISO(row.updated_at),
    last_accessed_at: toISO(row.last_accessed_at),
  };
}

/** Parse a relation row: JSON metadata + ISO 8601 timestamps. */
export function parseRelationRow(row: RelationRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    created_at: toISO(row.created_at),
    updated_at: toISO(row.updated_at),
  };
}

/** Parse a conversation row: JSON metadata + ISO 8601 timestamps. */
export function parseConversationRow(row: ConversationRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    created_at: toISO(row.created_at),
    updated_at: toISO(row.updated_at),
  };
}

/** Parse a message row: JSON metadata + ISO 8601 timestamp. */
export function parseMessageRow(row: MessageRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    created_at: toISO(row.created_at),
  };
}

/** Parse a namespace row: JSON metadata + ISO 8601 timestamps. */
export function parseNamespaceRow(row: NamespaceRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    created_at: toISO(row.created_at),
    updated_at: toISO(row.updated_at),
  };
}
