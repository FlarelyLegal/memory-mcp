/** Shared row-parsing helpers for converting DB rows to API responses. */
import { parseJson } from "../utils.js";
import type { EntityRow, MemoryRow } from "../types.js";

/** Parse metadata JSON string in an entity row into an object. */
export function parseEntityRow(row: EntityRow) {
  return { ...row, metadata: row.metadata ? parseJson(row.metadata) : null };
}

/** Parse metadata JSON string in a memory row into an object. */
export function parseMemoryRow(row: MemoryRow) {
  return { ...row, metadata: row.metadata ? parseJson(row.metadata) : null };
}
