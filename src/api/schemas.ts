/** Reusable OpenAPI schema fragments, parameter helpers, and query utilities. */
import type { SchemaObject, ParameterObject } from "./types.js";

// --- Query helpers ---

/** Parse a "limit" query parameter with a default and maximum cap. */
export function queryLimit(query: URLSearchParams, max: number, def: number = 20): number {
  return Math.min(Number(query.get("limit") ?? def), max);
}

// --- Common parameters ---

export function nsPathParam(): ParameterObject {
  return { name: "namespace_id", in: "path", required: true, schema: { type: "string" } };
}

export function idPathParam(desc: string): ParameterObject {
  return { name: "id", in: "path", required: true, description: desc, schema: { type: "string" } };
}

export function limitQueryParam(max: number): ParameterObject {
  return { name: "limit", in: "query", schema: { type: "integer", maximum: max } };
}

// --- Common response schemas ---

export function okSchema(): SchemaObject {
  return { type: "object", properties: { ok: { type: "boolean" } } };
}

export function errorBodySchema(): SchemaObject {
  return { type: "object", properties: { error: { type: "string" } }, required: ["error"] };
}

// --- Domain schemas ---

export function namespaceSchema(): SchemaObject {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string", nullable: true },
      owner: { type: "string", nullable: true },
      visibility: { type: "string", enum: ["private", "public"] },
      metadata: { type: "string", nullable: true },
      created_at: { type: "number" },
      updated_at: { type: "number" },
    },
  };
}

export function entitySchema(): SchemaObject {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      namespace_id: { type: "string" },
      name: { type: "string" },
      type: { type: "string" },
      summary: { type: "string", nullable: true },
      metadata: { type: "object", nullable: true },
      created_at: { type: "number" },
      updated_at: { type: "number" },
      last_accessed_at: { type: "number" },
      access_count: { type: "number" },
    },
  };
}

export function relationSchema(): SchemaObject {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      namespace_id: { type: "string" },
      source_id: { type: "string" },
      target_id: { type: "string" },
      relation_type: { type: "string" },
      weight: { type: "number" },
      metadata: { type: "string", nullable: true },
      created_at: { type: "number" },
      updated_at: { type: "number" },
    },
  };
}

export function memorySchema(): SchemaObject {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      namespace_id: { type: "string" },
      content: { type: "string" },
      type: { type: "string" },
      source: { type: "string", nullable: true },
      importance: { type: "number" },
      metadata: { type: "object", nullable: true },
      created_at: { type: "number" },
      updated_at: { type: "number" },
      last_accessed_at: { type: "number" },
      access_count: { type: "number" },
    },
  };
}

export function conversationSchema(): SchemaObject {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      namespace_id: { type: "string" },
      title: { type: "string", nullable: true },
      metadata: { type: "string", nullable: true },
      created_at: { type: "number" },
      updated_at: { type: "number" },
    },
  };
}

export function messageSchema(): SchemaObject {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      conversation_id: { type: "string" },
      role: { type: "string" },
      content: { type: "string" },
      metadata: { type: "string", nullable: true },
      created_at: { type: "number" },
    },
  };
}

export function tokenSchema(): SchemaObject {
  return {
    type: "object",
    properties: {
      common_name: { type: "string" },
      email: { type: "string" },
      label: { type: "string" },
      created_at: { type: "number" },
    },
  };
}

// --- Reusable input fragments ---

/** Metadata input schema for request bodies. */
export function metadataSchema(): SchemaObject {
  return { type: "object", additionalProperties: true, description: "Arbitrary JSON metadata" };
}

/** Memory type enum values. */
export const MEMORY_TYPES = ["fact", "observation", "preference", "instruction"] as const;

export function memoryTypeEnum(): SchemaObject {
  return { type: "string", enum: [...MEMORY_TYPES] };
}

/** Message role enum values. */
export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;

export function roleEnum(): SchemaObject {
  return { type: "string", enum: [...MESSAGE_ROLES] };
}
