/**
 * Memory Graph MCP Server
 *
 * A remote MCP server deployed on Cloudflare Workers that provides LLMs
 * with persistent, structured memory: entity graphs, semantic search,
 * conversation history, and temporally-decayed recall.
 *
 * Uses McpAgent (Durable Objects) so each session gets its own stateful
 * instance with direct access to env bindings.
 *
 * Secured with Cloudflare Access via OAuthProvider.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Env, AuthProps } from "./types.js";
import * as graph from "./graph.js";
import * as memories from "./memories.js";
import * as conversations from "./conversations.js";
import * as embeddings from "./embeddings.js";
import { parseJson } from "./utils.js";
import { handleAccessRequest } from "./access-handler.js";
import {
  assertNamespaceAccess,
  assertEntityAccess,
  assertMemoryAccess,
  assertConversationAccess,
  assertRelationAccess,
  AccessDeniedError,
} from "./auth.js";

export class MemoryGraphMCP extends McpAgent<Env, Record<string, never>, AuthProps> {
  server = new McpServer({
    name: "Memory Graph",
    version: "0.1.0",
  });

  /** Get the authenticated user's email, or throw. */
  private get email(): string {
    const e = this.props?.email;
    if (!e) throw new Error("Not authenticated");
    return e;
  }

  async init() {
    // ============================================================
    // NAMESPACE TOOLS
    // ============================================================

    this.server.tool(
      "create_namespace",
      "Create a new namespace to scope memories (e.g. per-user, per-project)",
      {
        name: z.string().describe("Human-readable namespace name"),
        description: z.string().optional().describe("What this namespace is for"),
      },
      async ({ name, description }) => {
        const id = await graph.createNamespace(this.env.DB, { name, description, owner: this.email });
        return { content: [{ type: "text" as const, text: JSON.stringify({ id, name }) }] };
      },
    );

    this.server.tool(
      "list_namespaces",
      "List all available namespaces you have access to",
      {},
      async () => {
        const ns = await graph.listNamespaces(this.env.DB, this.email);
        return { content: [{ type: "text" as const, text: JSON.stringify(ns) }] };
      },
    );

    // ============================================================
    // ENTITY TOOLS
    // ============================================================

    this.server.tool(
      "create_entity",
      "Create an entity (node) in the knowledge graph -- a person, concept, project, tool, etc.",
      {
        namespace_id: z.string().describe("Namespace to create the entity in"),
        name: z.string().describe("Entity name"),
        type: z.string().describe("Entity type: person, concept, project, tool, location, organization, etc."),
        summary: z.string().optional().describe("Brief description of the entity"),
        metadata: z.string().optional().describe("Optional JSON string of additional properties"),
      },
      async ({ namespace_id, name, type, summary, metadata }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const id = await graph.createEntity(this.env.DB, {
          namespace_id,
          name,
          type,
          summary,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        await embeddings.upsertEntityVector(this.env, {
          entity_id: id,
          namespace_id,
          name,
          type,
          summary: summary ?? null,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ id, name, type }) }] };
      },
    );

    this.server.tool(
      "get_entity",
      "Get a specific entity by ID, including its details",
      {
        id: z.string().describe("Entity ID"),
      },
      async ({ id }) => {
        await assertEntityAccess(this.env.DB, id, this.email);
        const entity = await graph.getEntity(this.env.DB, id);
        if (!entity) return { content: [{ type: "text" as const, text: "Entity not found" }] };
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ...entity, metadata: parseJson(entity.metadata) }) }],
        };
      },
    );

    this.server.tool(
      "search_entities",
      "Search entities by name, type, or keyword within a namespace",
      {
        namespace_id: z.string().describe("Namespace to search in"),
        query: z.string().optional().describe("Search term to match against name/summary"),
        type: z.string().optional().describe("Filter by entity type"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
      async ({ namespace_id, query, type, limit }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const results = await graph.searchEntities(this.env.DB, namespace_id, { query, type, limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    this.server.tool(
      "update_entity",
      "Update an existing entity's name, type, summary, or metadata",
      {
        id: z.string().describe("Entity ID to update"),
        name: z.string().optional(),
        type: z.string().optional(),
        summary: z.string().optional(),
        metadata: z.string().optional().describe("JSON string of properties to set"),
      },
      async ({ id, name, type, summary, metadata }) => {
        await assertEntityAccess(this.env.DB, id, this.email);
        await graph.updateEntity(this.env.DB, id, {
          name,
          type,
          summary,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        if (name || type || summary) {
          const entity = await graph.getEntity(this.env.DB, id);
          if (entity) {
            await embeddings.upsertEntityVector(this.env, {
              entity_id: id,
              namespace_id: entity.namespace_id,
              name: entity.name,
              type: entity.type,
              summary: entity.summary,
            });
          }
        }
        return { content: [{ type: "text" as const, text: `Updated entity ${id}` }] };
      },
    );

    this.server.tool(
      "delete_entity",
      "Delete an entity and all its relations",
      {
        id: z.string().describe("Entity ID to delete"),
      },
      async ({ id }) => {
        await assertEntityAccess(this.env.DB, id, this.email);
        await graph.deleteEntity(this.env.DB, id);
        await embeddings.deleteVector(this.env, "entity", id);
        return { content: [{ type: "text" as const, text: `Deleted entity ${id}` }] };
      },
    );

    // ============================================================
    // RELATION TOOLS
    // ============================================================

    this.server.tool(
      "create_relation",
      "Create a directed relationship between two entities (e.g. 'Alice' --knows--> 'Bob')",
      {
        namespace_id: z.string(),
        source_id: z.string().describe("Source entity ID (from)"),
        target_id: z.string().describe("Target entity ID (to)"),
        relation_type: z.string().describe("Relationship label: knows, uses, depends_on, part_of, related_to, etc."),
        weight: z.number().optional().describe("Strength of relation 0.0-1.0 (default 1.0)"),
        metadata: z.string().optional().describe("Optional JSON string of additional properties"),
      },
      async ({ namespace_id, source_id, target_id, relation_type, weight, metadata }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const id = await graph.createRelation(this.env.DB, {
          namespace_id,
          source_id,
          target_id,
          relation_type,
          weight,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id, source_id, target_id, relation_type }) }],
        };
      },
    );

    this.server.tool(
      "get_relations",
      "Get all relations from or to an entity",
      {
        entity_id: z.string().describe("Entity ID"),
        direction: z.enum(["from", "to", "both"]).optional().describe("Direction of relations (default: both)"),
        relation_type: z.string().optional().describe("Filter by relation type"),
        limit: z.number().optional(),
      },
      async ({ entity_id, direction, relation_type, limit }) => {
        await assertEntityAccess(this.env.DB, entity_id, this.email);
        const dir = direction ?? "both";
        const results: unknown[] = [];

        if (dir === "from" || dir === "both") {
          const rels = await graph.getRelationsFrom(this.env.DB, entity_id, { relation_type, limit });
          results.push(...rels.map((r) => ({ ...r, direction: "outgoing" })));
        }
        if (dir === "to" || dir === "both") {
          const rels = await graph.getRelationsTo(this.env.DB, entity_id, { relation_type, limit });
          results.push(...rels.map((r) => ({ ...r, direction: "incoming" })));
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    this.server.tool(
      "delete_relation",
      "Delete a specific relation by ID",
      { id: z.string() },
      async ({ id }) => {
        await assertRelationAccess(this.env.DB, id, this.email);
        await graph.deleteRelation(this.env.DB, id);
        return { content: [{ type: "text" as const, text: `Deleted relation ${id}` }] };
      },
    );

    // ============================================================
    // GRAPH TRAVERSAL
    // ============================================================

    this.server.tool(
      "traverse_graph",
      "Traverse the knowledge graph via BFS from a starting entity. Returns all reachable entities and relations up to maxDepth hops. Useful for understanding context around a topic.",
      {
        entity_id: z.string().describe("Starting entity ID"),
        max_depth: z.number().optional().describe("Max hops (default 2)"),
        relation_types: z.array(z.string()).optional().describe("Only follow these relation types"),
      },
      async ({ entity_id, max_depth, relation_types }) => {
        await assertEntityAccess(this.env.DB, entity_id, this.email);
        const result = await graph.traverse(this.env.DB, entity_id, {
          maxDepth: max_depth,
          relationTypes: relation_types,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );

    // ============================================================
    // MEMORY TOOLS
    // ============================================================

    this.server.tool(
      "create_memory",
      "Store a knowledge fragment -- a fact, observation, user preference, or instruction. Optionally link to entities.",
      {
        namespace_id: z.string(),
        content: z.string().describe("The memory content / knowledge to store"),
        type: z
          .enum(["fact", "observation", "preference", "instruction"])
          .optional()
          .describe("Memory type (default: fact)"),
        importance: z
          .number()
          .optional()
          .describe("Importance score 0.0-1.0 (default 0.5). Higher = decays slower"),
        source: z.string().optional().describe("Source reference (e.g. conversation ID)"),
        entity_ids: z.array(z.string()).optional().describe("Entity IDs this memory relates to"),
        metadata: z.string().optional().describe("Optional JSON properties"),
      },
      async ({ namespace_id, content, type, importance, source, entity_ids, metadata }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const id = await memories.createMemory(this.env.DB, {
          namespace_id,
          content,
          type,
          importance,
          source,
          entity_ids,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        await embeddings.upsertMemoryVector(this.env, {
          memory_id: id,
          namespace_id,
          content,
          type: type ?? "fact",
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ id, type: type ?? "fact" }) }] };
      },
    );

    this.server.tool(
      "recall_memories",
      "Recall memories ranked by relevance (blends importance with temporal recency). More important and recently accessed memories rank higher.",
      {
        namespace_id: z.string(),
        type: z.enum(["fact", "observation", "preference", "instruction"]).optional(),
        limit: z.number().optional().describe("Max memories to return (default 20)"),
      },
      async ({ namespace_id, type, limit }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const results = await memories.recallMemories(this.env.DB, namespace_id, { type, limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    this.server.tool(
      "search_memories",
      "Search memories by keyword within a namespace",
      {
        namespace_id: z.string(),
        query: z.string().describe("Search term"),
        type: z.enum(["fact", "observation", "preference", "instruction"]).optional(),
        limit: z.number().optional(),
      },
      async ({ namespace_id, query, type, limit }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const results = await memories.searchMemories(this.env.DB, namespace_id, { query, type, limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    this.server.tool(
      "get_entity_memories",
      "Get all memories linked to a specific entity",
      {
        entity_id: z.string(),
        limit: z.number().optional(),
      },
      async ({ entity_id, limit }) => {
        await assertEntityAccess(this.env.DB, entity_id, this.email);
        const results = await memories.getMemoriesForEntity(this.env.DB, entity_id, { limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    this.server.tool(
      "update_memory",
      "Update an existing memory's content, type, or importance",
      {
        id: z.string(),
        content: z.string().optional(),
        type: z.enum(["fact", "observation", "preference", "instruction"]).optional(),
        importance: z.number().optional(),
        metadata: z.string().optional(),
      },
      async ({ id, content, type, importance, metadata }) => {
        await assertMemoryAccess(this.env.DB, id, this.email);
        await memories.updateMemory(this.env.DB, id, {
          content,
          type,
          importance,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        if (content) {
          const mem = await memories.getMemory(this.env.DB, id);
          if (mem) {
            await embeddings.upsertMemoryVector(this.env, {
              memory_id: id,
              namespace_id: mem.namespace_id,
              content: mem.content,
              type: mem.type,
            });
          }
        }
        return { content: [{ type: "text" as const, text: `Updated memory ${id}` }] };
      },
    );

    this.server.tool(
      "delete_memory",
      "Delete a memory by ID",
      { id: z.string() },
      async ({ id }) => {
        await assertMemoryAccess(this.env.DB, id, this.email);
        await memories.deleteMemory(this.env.DB, id);
        await embeddings.deleteVector(this.env, "memory", id);
        return { content: [{ type: "text" as const, text: `Deleted memory ${id}` }] };
      },
    );

    // ============================================================
    // CONVERSATION TOOLS
    // ============================================================

    this.server.tool(
      "create_conversation",
      "Start tracking a new conversation",
      {
        namespace_id: z.string(),
        title: z.string().optional().describe("Conversation title/topic"),
        metadata: z.string().optional().describe("JSON: model name, system prompt hash, etc."),
      },
      async ({ namespace_id, title, metadata }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const id = await conversations.createConversation(this.env.DB, {
          namespace_id,
          title,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ id, title }) }] };
      },
    );

    this.server.tool(
      "list_conversations",
      "List recent conversations in a namespace",
      {
        namespace_id: z.string(),
        limit: z.number().optional(),
      },
      async ({ namespace_id, limit }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const results = await conversations.listConversations(this.env.DB, namespace_id, { limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    this.server.tool(
      "add_message",
      "Add a message to a conversation",
      {
        conversation_id: z.string(),
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.string(),
        metadata: z.string().optional(),
      },
      async ({ conversation_id, role, content, metadata }) => {
        await assertConversationAccess(this.env.DB, conversation_id, this.email);
        const id = await conversations.addMessage(this.env.DB, {
          conversation_id,
          role,
          content,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        });
        if (role === "user" || role === "assistant") {
          const convo = await conversations.getConversation(this.env.DB, conversation_id);
          if (convo) {
            await embeddings.upsertMessageVector(this.env, {
              message_id: id,
              conversation_id,
              namespace_id: convo.namespace_id,
              content,
              role,
            });
          }
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ id, role }) }] };
      },
    );

    this.server.tool(
      "get_messages",
      "Get messages from a conversation in chronological order",
      {
        conversation_id: z.string(),
        limit: z.number().optional().describe("Max messages (default 50, most recent)"),
      },
      async ({ conversation_id, limit }) => {
        await assertConversationAccess(this.env.DB, conversation_id, this.email);
        const results = await conversations.getMessages(this.env.DB, conversation_id, { limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    this.server.tool(
      "search_conversations",
      "Search across all conversation messages in a namespace by keyword",
      {
        namespace_id: z.string(),
        query: z.string(),
        limit: z.number().optional(),
      },
      async ({ namespace_id, query, limit }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const results = await conversations.searchMessages(this.env.DB, namespace_id, query, { limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    // ============================================================
    // SEMANTIC SEARCH
    // ============================================================

    this.server.tool(
      "semantic_search",
      "Search the entire memory graph by meaning/similarity. Uses vector embeddings to find the most relevant entities, memories, and conversation messages for a natural language query. This is the best tool for 'what do I know about X?' style questions.",
      {
        namespace_id: z.string(),
        query: z.string().describe("Natural language query"),
        kind: z
          .enum(["entity", "memory", "message"])
          .optional()
          .describe("Filter to a specific type (default: search all)"),
        limit: z.number().optional().describe("Max results (default 10)"),
      },
      async ({ namespace_id, query, kind, limit }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const results = await embeddings.semanticSearch(this.env, query, namespace_id, { kind, limit });
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      },
    );

    // ============================================================
    // COMPOSITE: CONTEXT RETRIEVAL
    // ============================================================

    this.server.tool(
      "get_context",
      "High-level tool: retrieves a rich context bundle for a query. Combines semantic search, graph traversal, and memory recall into a single response suitable for injecting into an LLM prompt. Use this when you want to gather everything relevant about a topic.",
      {
        namespace_id: z.string(),
        query: z.string().describe("What you want context about"),
        limit: z.number().optional().describe("Max items per category (default 5)"),
      },
      async ({ namespace_id, query, limit }) => {
        await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        const n = limit ?? 5;

        const semanticResults = await embeddings.semanticSearch(this.env, query, namespace_id, { limit: n });

        const entityContext: unknown[] = [];
        for (const result of semanticResults.filter((r) => r.kind === "entity")) {
          const entityId = result.metadata.entity_id;
          if (!entityId) continue;

          const [entity, outRels, inRels, entityMems] = await Promise.all([
            graph.getEntity(this.env.DB, entityId),
            graph.getRelationsFrom(this.env.DB, entityId, { limit: 5 }),
            graph.getRelationsTo(this.env.DB, entityId, { limit: 5 }),
            memories.getMemoriesForEntity(this.env.DB, entityId, { limit: 5 }),
          ]);

          entityContext.push({
            entity: entity ? { ...entity, metadata: parseJson(entity.metadata) } : null,
            outgoing_relations: outRels,
            incoming_relations: inRels,
            memories: entityMems,
          });
        }

        const rankedMemories = await memories.recallMemories(this.env.DB, namespace_id, { limit: n });
        const keywordMemories = await memories.searchMemories(this.env.DB, namespace_id, {
          query,
          limit: n,
        });

        const context = {
          semantic_matches: semanticResults,
          entity_context: entityContext,
          top_memories: rankedMemories,
          keyword_memories: keywordMemories,
        };

         return { content: [{ type: "text" as const, text: JSON.stringify(context) }] };
      },
    );

    // ============================================================
    // ADMIN / MAINTENANCE
    // ============================================================

    this.server.tool(
      "reindex_vectors",
      "Re-embed all entities and memories into Vectorize. Use this to fix missing vectors or after the embedding model changes. Returns counts of items reindexed.",
      {
        namespace_id: z.string().describe("Namespace to reindex (or 'all' for everything)"),
      },
      async ({ namespace_id }) => {
        // For "all", reindex only namespaces the user owns
        if (namespace_id !== "all") {
          await assertNamespaceAccess(this.env.DB, namespace_id, this.email);
        }

        let entityCount = 0;
        let memoryCount = 0;
        let errorCount = 0;

        // Get entities to reindex (scoped to user's namespaces)
        const entityQuery = namespace_id === "all"
          ? "SELECT e.id, e.namespace_id, e.name, e.type, e.summary FROM entities e JOIN namespaces n ON n.id = e.namespace_id WHERE n.owner = ? OR n.owner IS NULL"
          : "SELECT id, namespace_id, name, type, summary FROM entities WHERE namespace_id = ?";
        const entityResult = await this.env.DB.prepare(entityQuery)
          .bind(namespace_id === "all" ? this.email : namespace_id)
          .all<{ id: string; namespace_id: string; name: string; type: string; summary: string | null }>();

        for (const entity of entityResult.results) {
          try {
            await embeddings.upsertEntityVector(this.env, {
              entity_id: entity.id,
              namespace_id: entity.namespace_id,
              name: entity.name,
              type: entity.type,
              summary: entity.summary,
            });
            entityCount++;
          } catch {
            errorCount++;
          }
        }

        // Get memories to reindex (scoped to user's namespaces)
        const memoryQuery = namespace_id === "all"
          ? "SELECT m.id, m.namespace_id, m.content, m.type FROM memories m JOIN namespaces n ON n.id = m.namespace_id WHERE n.owner = ? OR n.owner IS NULL"
          : "SELECT id, namespace_id, content, type FROM memories WHERE namespace_id = ?";
        const memoryResult = await this.env.DB.prepare(memoryQuery)
          .bind(namespace_id === "all" ? this.email : namespace_id)
          .all<{ id: string; namespace_id: string; content: string; type: string }>();

        for (const memory of memoryResult.results) {
          try {
            await embeddings.upsertMemoryVector(this.env, {
              memory_id: memory.id,
              namespace_id: memory.namespace_id,
              content: memory.content,
              type: memory.type,
            });
            memoryCount++;
          } catch {
            errorCount++;
          }
        }

        const summary = {
          entities_reindexed: entityCount,
          memories_reindexed: memoryCount,
          errors: errorCount,
          total: entityCount + memoryCount,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary) }] };
      },
    );
  }
}

// Wrap MCP with OAuthProvider for Cloudflare Access authentication.
// The /health endpoint is handled inside the defaultHandler (access-handler.ts).
export default new OAuthProvider({
  apiHandler: MemoryGraphMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: { fetch: handleAccessRequest as unknown as ExportedHandlerFetchHandler },
  tokenEndpoint: "/token",
});
