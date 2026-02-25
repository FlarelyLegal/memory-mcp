// Cloudflare bindings
export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CACHE: KVNamespace;
}

// --- Domain types ---

export interface Namespace {
  id: string;
  name: string;
  description: string | null;
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
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export interface Memory {
  id: string;
  namespace_id: string;
  content: string;
  type: "fact" | "observation" | "preference" | "instruction";
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
  metadata: string | null;
  created_at: number;
  updated_at: number;
}
