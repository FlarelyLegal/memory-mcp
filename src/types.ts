import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface WorkerRateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

// Cloudflare bindings
export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  USERS: KVNamespace;
  FLAGS: KVNamespace;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  // OAuth / Cloudflare Access
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
  ACCESS_TOKEN_URL: string;
  ACCESS_AUTHORIZATION_URL: string;
  ACCESS_JWKS_URL: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUD_TAG: string;
  COOKIE_ENCRYPTION_KEY: string;
  RATE_LIMIT_AUTH?: WorkerRateLimiter;
  RATE_LIMIT_SEARCH?: WorkerRateLimiter;
  // Analytics
  ANALYTICS?: AnalyticsEngineDataset;
  // Workflows
  REINDEX_WORKFLOW: Workflow;
  CONSOLIDATION_WORKFLOW: Workflow;
}

// Per-session state tracked across tool calls (persisted in DO SQLite)
export interface SessionState {
  /** Last-used namespace ID — defaults for tools when namespace_id is omitted. */
  currentNamespace?: string;
  /** Recently accessed entity IDs (most recent first, capped at 10). */
  recentEntities: string[];
  /** Last-used conversation ID — defaults for add_message/get_messages. */
  currentConversation?: string;
}

/** Thin interface for tool handlers to read/write session state without importing McpAgent. */
export interface StateHandle {
  readonly state: SessionState;
  setState(s: SessionState): void;
}

// Props passed through from the OAuth flow into McpAgent
export interface AuthProps {
  accessToken: string;
  email: string;
  login: string;
  name: string;
  [key: string]: unknown;
}

// --- Shared enums ---

export type MemoryType = "fact" | "observation" | "preference" | "instruction";
export type MessageRole = "user" | "assistant" | "system" | "tool";

// --- Domain types ---

export type NamespaceVisibility = "private" | "public";

export interface Namespace {
  id: string;
  name: string;
  description: string | null;
  owner: string | null;
  visibility: NamespaceVisibility;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface Entity {
  id: string;
  namespace_id: string;
  name: string;
  type: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
}

export interface Relation {
  id: string;
  namespace_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight: number;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface Conversation {
  id: string;
  namespace_id: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export interface Memory {
  id: string;
  namespace_id: string;
  content: string;
  type: MemoryType;
  source: string | null;
  importance: number;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
}

// --- DB row types (JSON stored as TEXT) ---

export interface EntityRow {
  id: string;
  namespace_id: string;
  name: string;
  type: string;
  summary: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
}

export interface RelationRow {
  id: string;
  namespace_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  weight: number;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface MemoryRow {
  id: string;
  namespace_id: string;
  content: string;
  type: string;
  source: string | null;
  importance: number;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: string | null;
  created_at: number;
}

export interface ConversationRow {
  id: string;
  namespace_id: string;
  title: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface NamespaceRow {
  id: string;
  name: string;
  description: string | null;
  owner: string | null;
  visibility: NamespaceVisibility;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface AuditLogRow {
  id: string;
  namespace_id: string | null;
  email: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: string | null;
  created_at: number;
}

export * from "./rbac-types.js";
