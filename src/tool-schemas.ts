/**
 * Shared Zod schemas for MCP tools and REST API.
 *
 * Single source of truth: MCP tools import Zod schemas directly,
 * REST validators compose from them, and OpenAPI specs derive
 * JSON Schema via Zod v4's native toJSONSchema().
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const MEMORY_TYPES = ["fact", "observation", "preference", "instruction"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export const VISIBILITY_OPTIONS = ["private", "public"] as const;
export const SEARCH_MODES = ["semantic", "context"] as const;
export const SEARCH_KINDS = ["entity", "memory", "message"] as const;
export const QUERY_MODES = ["recall", "search", "entity"] as const;
export const WORKFLOW_TYPES = ["reindex", "consolidation"] as const;
export const RELATION_DIRECTIONS = ["from", "to", "both"] as const;

export const memoryType = z.enum(MEMORY_TYPES);
export const messageRole = z.enum(MESSAGE_ROLES);
export const visibility = z.enum(VISIBILITY_OPTIONS);

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

export const nameField = z.string().min(1).max(200);
export const typeField = z.string().min(1).max(200);
export const typeFilter = z.string().max(200);
export const summaryField = z.string().max(10_000);
export const descriptionField = z.string().max(2000);
export const metadataObject = z.record(z.string(), z.unknown());
export const memoryContent = z.string().min(1).max(10_000);
export const messageContent = z.string().min(1).max(50_000);
export const importance = z.number().min(0).max(1);
export const sourceField = z.string().max(500);
export const entityIds = z.array(z.string().uuid()).max(100);
export const queryField = z.string().min(1).max(1000);
export const relationType = z.string().min(1).max(200);
export const relationWeight = z.number().min(0).max(1);
export const titleField = z.string().min(1).max(500);

// ---------------------------------------------------------------------------
// Composite schemas — used by both MCP tools and REST validators
// ---------------------------------------------------------------------------

export const entityCreateFields = {
  name: nameField,
  type: typeField,
  summary: summaryField.optional(),
};

export const relationCreateFields = {
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation_type: relationType,
  weight: relationWeight.optional(),
};

export const memoryCreateFields = {
  content: memoryContent,
  type: memoryType.optional(),
  importance: importance.optional(),
  source: sourceField.optional(),
  entity_ids: entityIds.optional(),
};

export const messageCreateFields = {
  role: messageRole,
  content: messageContent,
};

export const searchFields = {
  query: queryField,
  mode: z.enum(SEARCH_MODES).optional(),
  kind: z.enum(SEARCH_KINDS).optional(),
  type: typeFilter.optional(),
  after: z.number().optional(),
  before: z.number().optional(),
  role: messageRole.optional(),
  conversation_id: z.string().uuid().optional(),
  limit: z.number().optional(),
};

export const consolidateFields = {
  namespace_id: z.string().uuid(),
  decay_threshold: z.number().min(0).max(1).optional(),
  skip_merge: z.boolean().optional(),
  merge_threshold: z.number().min(0).max(1).optional(),
  skip_summaries: z.boolean().optional(),
  purge_after_days: z.number().int().min(1).max(365).optional(),
};
