/** Shared row-parsing helpers for converting DB rows to API responses. */
import { parseJson, toISO } from "../utils.js";
import type {
  EntityRow,
  MemoryRow,
  RelationRow,
  ConversationRow,
  MessageRow,
  NamespaceRow,
  GroupRow,
  GroupMemberRow,
  NamespaceGrantRow,
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

/** Parse a group row: JSON settings + ISO 8601 timestamps. */
export function parseGroupRow(row: GroupRow) {
  return {
    ...row,
    settings: row.settings ? parseJson(row.settings) : null,
    created_at: toISO(row.created_at),
    updated_at: toISO(row.updated_at),
    deleted_at: row.deleted_at ? toISO(row.deleted_at) : null,
  };
}

/** Parse a group member row: JSON metadata + ISO 8601 timestamps. */
export function parseGroupMemberRow(row: GroupMemberRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    added_at: toISO(row.added_at),
    invited_at: row.invited_at ? toISO(row.invited_at) : null,
    accepted_at: row.accepted_at ? toISO(row.accepted_at) : null,
    expires_at: row.expires_at ? toISO(row.expires_at) : null,
  };
}

/** Parse a namespace grant row: JSON fields + ISO 8601 timestamps. */
export function parseNamespaceGrantRow(row: NamespaceGrantRow) {
  return {
    ...row,
    metadata: row.metadata ? parseJson(row.metadata) : null,
    condition: row.condition ? parseJson(row.condition) : null,
    created_at: toISO(row.created_at),
    updated_at: toISO(row.updated_at),
    expires_at: row.expires_at ? toISO(row.expires_at) : null,
    revoked_at: row.revoked_at ? toISO(row.revoked_at) : null,
  };
}
