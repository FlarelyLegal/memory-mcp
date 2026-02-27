/** Shared types for the REST API layer. */
import type { Env } from "../types.js";

export type AuthIdentity =
  | { type: "human"; email: string }
  | { type: "service_token"; common_name: string; email: string | null; bound: boolean };

/** Authenticated request context passed to every route handler. */
export interface ApiContext {
  env: Env;
  email: string;
  auth: AuthIdentity;
  params: Record<string, string>;
  query: URLSearchParams;
}

/** HTTP methods supported by the router. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A single API route definition. */
export interface RouteDefinition {
  method: HttpMethod;
  pattern: string; // e.g. "/api/v1/entities/:id"
  handler: (ctx: ApiContext, request: Request) => Promise<Response>;
  spec: PathOperation;
  /** If true, skip auth (e.g. docs, openapi.json). */
  public?: boolean;
  /** If true, unbound service tokens may authenticate for this route. */
  allowUnboundServiceToken?: boolean;
}

// --- OpenAPI 3.1 subset types (just enough to build accurate specs) ---

export interface PathOperation {
  summary: string;
  description?: string;
  tags: string[];
  operationId: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema: SchemaObject;
}

export interface RequestBodyObject {
  required?: boolean;
  content: Record<string, { schema: SchemaObject }>;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, { schema: SchemaObject }>;
}

/** JSON Schema subset for OpenAPI 3.1. */
export interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  enum?: (string | number)[];
  nullable?: boolean;
  maxLength?: number;
  maximum?: number;
  minimum?: number;
  default?: unknown;
  example?: unknown;
  additionalProperties?: boolean | SchemaObject;
}
