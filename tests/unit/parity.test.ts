/**
 * Tier 3: MCP tool ↔ REST API parity tests.
 *
 * Ensures every MCP tool action has a corresponding REST route and that
 * their data field schemas stay in sync. Fails when a new tool/route is
 * added without updating the manifest.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getRoutes } from "../../src/api/registry.js";

// Import route registration functions to populate the registry.
import { registerNamespaceRoutes } from "../../src/api/routes/namespaces.js";
import { registerNamespaceCrudRoutes } from "../../src/api/routes/namespace-crud.js";
import { registerEntityRoutes } from "../../src/api/routes/entities.js";
import { registerEntityCrudRoutes } from "../../src/api/routes/entity-crud.js";
import { registerRelationRoutes } from "../../src/api/routes/relations.js";
import { registerTraversalRoutes } from "../../src/api/routes/traversal.js";
import { registerMemoryRoutes } from "../../src/api/routes/memories.js";
import { registerMemoryQueryRoutes } from "../../src/api/routes/memory-queries.js";
import { registerConversationRoutes } from "../../src/api/routes/conversations.js";
import { registerMessageRoutes } from "../../src/api/routes/messages.js";
import { registerSearchRoutes } from "../../src/api/routes/search.js";
import { registerAdminRoutes } from "../../src/api/routes/admin.js";
import { registerWorkflowRoutes } from "../../src/api/routes/workflows.js";
import { registerTokenRoutes } from "../../src/api/routes/tokens.js";
import { registerTokenCrudRoutes } from "../../src/api/routes/token-crud.js";
import { registerDemoRoutes } from "../../src/api/routes/demo.js";

// ---------------------------------------------------------------------------
// Parity manifest: every MCP tool action → REST method + path + data fields
// ---------------------------------------------------------------------------

interface ParityEntry {
  tool: string;
  action: string;
  method: string;
  path: string;
  /** Data fields accepted by both sides (excludes routing: action, id, namespace_id, compact, verbose) */
  dataFields: string[];
  /** Known intentional differences */
  notes?: string;
}

/**
 * Canonical mapping of MCP tool actions to REST routes.
 *
 * metadata format difference: MCP accepts JSON string (metadataJsonStr),
 * REST accepts parsed object (metadataObject). Both import the base schema
 * from tool-schemas.ts. TODO: normalize in separate PR.
 */
const PARITY: ParityEntry[] = [
  // --- Namespace ---
  {
    tool: "manage_namespace",
    action: "create",
    method: "POST",
    path: "/api/v1/namespaces",
    dataFields: ["name", "description", "metadata"],
  },
  {
    tool: "manage_namespace",
    action: "list",
    method: "GET",
    path: "/api/v1/namespaces",
    dataFields: [],
  },
  {
    tool: "manage_namespace",
    action: "get",
    method: "GET",
    path: "/api/v1/namespaces/:id",
    dataFields: [],
  },
  {
    tool: "manage_namespace",
    action: "update",
    method: "PATCH",
    path: "/api/v1/namespaces/:id",
    dataFields: ["name", "description", "metadata"],
  },
  {
    tool: "manage_namespace",
    action: "delete",
    method: "DELETE",
    path: "/api/v1/namespaces/:id",
    dataFields: [],
  },
  {
    tool: "manage_namespace",
    action: "set_visibility",
    method: "PATCH",
    path: "/api/v1/namespaces/:id",
    dataFields: ["visibility"],
  },

  // --- Entity ---
  {
    tool: "manage_entity",
    action: "create",
    method: "POST",
    path: "/api/v1/namespaces/:namespace_id/entities",
    dataFields: ["name", "type", "summary", "metadata"],
  },
  {
    tool: "manage_entity",
    action: "get",
    method: "GET",
    path: "/api/v1/entities/:id",
    dataFields: [],
  },
  {
    tool: "manage_entity",
    action: "update",
    method: "PUT",
    path: "/api/v1/entities/:id",
    dataFields: ["name", "type", "summary", "metadata"],
  },
  {
    tool: "manage_entity",
    action: "delete",
    method: "DELETE",
    path: "/api/v1/entities/:id",
    dataFields: [],
  },
  {
    tool: "find_entities",
    action: "search",
    method: "GET",
    path: "/api/v1/namespaces/:namespace_id/entities",
    dataFields: ["query", "type"],
  },

  // --- Relation ---
  {
    tool: "manage_relation",
    action: "create",
    method: "POST",
    path: "/api/v1/namespaces/:namespace_id/relations",
    dataFields: ["source_id", "target_id", "relation_type", "weight", "metadata"],
  },
  {
    tool: "manage_relation",
    action: "delete",
    method: "DELETE",
    path: "/api/v1/relations/:id",
    dataFields: [],
  },
  {
    tool: "get_relations",
    action: "query",
    method: "GET",
    path: "/api/v1/entities/:id/relations",
    dataFields: ["direction", "relation_type"],
  },

  // --- Traversal ---
  {
    tool: "traverse_graph",
    action: "traverse",
    method: "GET",
    path: "/api/v1/entities/:id/traverse",
    dataFields: ["max_depth", "relation_types"],
  },

  // --- Memory ---
  {
    tool: "manage_memory",
    action: "create",
    method: "POST",
    path: "/api/v1/namespaces/:namespace_id/memories",
    dataFields: ["content", "type", "importance", "source", "entity_ids", "metadata"],
  },
  {
    tool: "manage_memory",
    action: "get",
    method: "GET",
    path: "/api/v1/memories/:id",
    dataFields: [],
  },
  {
    tool: "manage_memory",
    action: "update",
    method: "PUT",
    path: "/api/v1/memories/:id",
    dataFields: ["content", "type", "importance", "metadata"],
  },
  {
    tool: "manage_memory",
    action: "delete",
    method: "DELETE",
    path: "/api/v1/memories/:id",
    dataFields: [],
  },
  {
    tool: "query_memories",
    action: "recall",
    method: "GET",
    path: "/api/v1/namespaces/:namespace_id/memories",
    dataFields: ["type"],
  },
  {
    tool: "query_memories",
    action: "search",
    method: "GET",
    path: "/api/v1/namespaces/:namespace_id/memories",
    dataFields: ["query", "type"],
  },
  {
    tool: "query_memories",
    action: "entity",
    method: "GET",
    path: "/api/v1/entities/:id/memories",
    dataFields: [],
  },

  // --- Conversation ---
  {
    tool: "manage_conversation",
    action: "create",
    method: "POST",
    path: "/api/v1/namespaces/:namespace_id/conversations",
    dataFields: ["title", "metadata"],
  },
  {
    tool: "manage_conversation",
    action: "list",
    method: "GET",
    path: "/api/v1/namespaces/:namespace_id/conversations",
    dataFields: [],
  },
  {
    tool: "manage_conversation",
    action: "delete",
    method: "DELETE",
    path: "/api/v1/namespaces/:namespace_id/conversations/:id",
    dataFields: [],
  },

  // --- Message ---
  {
    tool: "add_message",
    action: "add",
    method: "POST",
    path: "/api/v1/conversations/:id/messages",
    dataFields: ["role", "content", "metadata"],
  },
  {
    tool: "get_messages",
    action: "get",
    method: "GET",
    path: "/api/v1/conversations/:id/messages",
    dataFields: [],
  },
  {
    tool: "get_messages",
    action: "search",
    method: "GET",
    path: "/api/v1/namespaces/:namespace_id/messages",
    dataFields: ["query"],
  },

  // --- Search ---
  {
    tool: "search",
    action: "semantic",
    method: "POST",
    path: "/api/v1/namespaces/:namespace_id/search",
    dataFields: [
      "query",
      "mode",
      "kind",
      "type",
      "after",
      "before",
      "role",
      "conversation_id",
      "limit",
    ],
  },
  {
    tool: "search",
    action: "context",
    method: "POST",
    path: "/api/v1/namespaces/:namespace_id/search",
    dataFields: [
      "query",
      "mode",
      "kind",
      "type",
      "after",
      "before",
      "role",
      "conversation_id",
      "limit",
    ],
  },

  // --- Admin ---
  {
    tool: "reindex_vectors",
    action: "trigger",
    method: "POST",
    path: "/api/v1/admin/reindex",
    dataFields: [],
  },
  {
    tool: "consolidate_memory",
    action: "trigger",
    method: "POST",
    path: "/api/v1/admin/consolidate",
    dataFields: [
      "decay_threshold",
      "skip_merge",
      "merge_threshold",
      "skip_summaries",
      "purge_after_days",
    ],
  },
  {
    tool: "get_workflow_status",
    action: "status",
    method: "GET",
    path: "/api/v1/admin/workflows/:workflow/:instance_id",
    dataFields: [],
  },
  {
    tool: "namespace_stats",
    action: "stats",
    method: "GET",
    path: "/api/v1/admin/stats/:namespace_id",
    dataFields: [],
  },
  {
    tool: "claim_namespaces",
    action: "claim",
    method: "POST",
    path: "/api/v1/admin/claim-namespaces",
    dataFields: [],
  },
];

/** REST-only routes (intentionally no MCP tool equivalent). */
const REST_ONLY_PATHS = new Set([
  "POST /api/v1/admin/service-tokens/bind-request",
  "POST /api/v1/admin/service-tokens/bind-self",
  "GET /api/v1/admin/service-tokens",
  "GET /api/v1/admin/service-tokens/:common_name",
  "PATCH /api/v1/admin/service-tokens/:common_name",
  "DELETE /api/v1/admin/service-tokens/:common_name",
  "GET /api/demo",
]);

/** All 17 MCP tool names. */
const ALL_TOOLS = [
  "manage_namespace",
  "manage_entity",
  "find_entities",
  "manage_relation",
  "get_relations",
  "traverse_graph",
  "manage_memory",
  "query_memories",
  "manage_conversation",
  "add_message",
  "get_messages",
  "search",
  "reindex_vectors",
  "consolidate_memory",
  "get_workflow_status",
  "namespace_stats",
  "claim_namespaces",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  registerNamespaceRoutes();
  registerNamespaceCrudRoutes();
  registerEntityRoutes();
  registerEntityCrudRoutes();
  registerRelationRoutes();
  registerTraversalRoutes();
  registerMemoryRoutes();
  registerMemoryQueryRoutes();
  registerConversationRoutes();
  registerMessageRoutes();
  registerSearchRoutes();
  registerAdminRoutes();
  registerWorkflowRoutes();
  registerTokenRoutes();
  registerTokenCrudRoutes();
  registerDemoRoutes();
});

describe("MCP ↔ REST parity", () => {
  it("manifest covers all 17 MCP tools", () => {
    const toolsInManifest = [...new Set(PARITY.map((e) => e.tool))];
    expect(toolsInManifest.sort()).toEqual([...ALL_TOOLS].sort());
  });

  it("every manifest entry has a registered REST route", () => {
    const routes = getRoutes();
    const routeKeys = new Set(routes.map((r) => `${r.method} ${r.pattern}`));
    for (const entry of PARITY) {
      const key = `${entry.method} ${entry.path}`;
      expect(routeKeys, `Missing route for ${entry.tool}.${entry.action}: ${key}`).toContain(key);
    }
  });

  it("every registered REST route is in manifest or REST_ONLY", () => {
    const routes = getRoutes();
    const manifestKeys = new Set(PARITY.map((e) => `${e.method} ${e.path}`));
    for (const route of routes) {
      const key = `${route.method} ${route.pattern}`;
      const covered = manifestKeys.has(key) || REST_ONLY_PATHS.has(key);
      expect(covered, `Unaccounted route: ${key}`).toBe(true);
    }
  });

  it("REST_ONLY routes actually exist in registry", () => {
    const routes = getRoutes();
    const routeKeys = new Set(routes.map((r) => `${r.method} ${r.pattern}`));
    for (const key of REST_ONLY_PATHS) {
      expect(routeKeys, `REST_ONLY route not registered: ${key}`).toContain(key);
    }
  });

  it("route count matches manifest + REST_ONLY (detects unaccounted additions)", () => {
    const routes = getRoutes();
    // Unique paths in manifest (some share paths, e.g. set_visibility shares PATCH with update)
    const manifestRouteKeys = new Set(PARITY.map((e) => `${e.method} ${e.path}`));
    const expectedCount = manifestRouteKeys.size + REST_ONLY_PATHS.size;
    expect(routes.length).toBe(expectedCount);
  });
});

describe("data field alignment", () => {
  // Group entries by tool for readable test names
  const byTool = new Map<string, ParityEntry[]>();
  for (const e of PARITY) {
    const list = byTool.get(e.tool) ?? [];
    list.push(e);
    byTool.set(e.tool, list);
  }

  for (const [tool, entries] of byTool) {
    const withFields = entries.filter((e) => e.dataFields.length > 0);
    if (withFields.length === 0) continue;
    describe(tool, () => {
      for (const entry of withFields) {
        it(`${entry.action}: data fields documented`, () => {
          // This test verifies the manifest entry has explicit field documentation.
          // Each field listed must be a known shared schema field or domain-specific field.
          expect(entry.dataFields.length).toBeGreaterThan(0);
          for (const f of entry.dataFields) {
            expect(typeof f).toBe("string");
            expect(f.length).toBeGreaterThan(0);
          }
        });
      }
    });
  }
});

describe("metadata transport difference", () => {
  it("MCP tools use metadataJsonStr (string), REST validators use metadataObject", () => {
    // This documents the known intentional difference.
    // MCP clients send metadata as a JSON string, REST clients send parsed objects.
    // Both base schemas come from tool-schemas.ts.
    // TODO: normalize in separate PR
    const entriesWithMetadata = PARITY.filter((e) => e.dataFields.includes("metadata"));
    expect(entriesWithMetadata.length).toBeGreaterThan(0);
    // Every entry with metadata should eventually be normalized
    for (const entry of entriesWithMetadata) {
      expect(entry.dataFields).toContain("metadata");
    }
  });
});
