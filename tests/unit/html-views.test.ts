/**
 * Unit tests for content-negotiated HTML page renderers.
 *
 * Tests the namespace list, namespace detail, and entity detail renderers
 * with populated and empty data.
 */
import { describe, it, expect } from "vitest";
import { renderNamespaceList } from "../../src/api/html/namespace-list.js";
import { renderNamespaceDetail } from "../../src/api/html/namespace-detail.js";
import { renderEntityDetail } from "../../src/api/html/entity-detail.js";

// ---------------------------------------------------------------------------
// Namespace list
// ---------------------------------------------------------------------------

describe("renderNamespaceList", () => {
  it("renders empty state when no namespaces", async () => {
    const res = renderNamespaceList([], new Map());
    const html = await res.text();
    expect(html).toContain("No namespaces found");
  });

  it("renders card grid for namespaces with stats", async () => {
    const ns = [
      {
        id: "ns-1",
        name: "Test NS",
        owner: "user@memory.flarelylegal.com",
        visibility: "public",
        description: "A test namespace",
        created_at: "2025-01-01T00:00:00Z",
      },
    ];
    const stats = new Map([
      [
        "ns-1",
        {
          namespace_id: "ns-1",
          entity_count: 5,
          memory_count: 10,
          relation_count: 3,
          conversation_count: 2,
          message_count: 20,
          avg_importance: 0.8,
          archived_count: 1,
        },
      ],
    ]);
    const html = await renderNamespaceList(ns, stats).text();
    expect(html).toContain("Test NS");
    expect(html).toContain("badge-public");
    expect(html).toContain("5");
    expect(html).toContain("10");
    expect(html).toContain("/api/v1/namespaces/ns-1");
  });
});

// ---------------------------------------------------------------------------
// Namespace detail
// ---------------------------------------------------------------------------

describe("renderNamespaceDetail", () => {
  it("renders namespace header with stats and sections", async () => {
    const html = await renderNamespaceDetail({
      namespace: {
        id: "ns-1",
        name: "Demo",
        owner: "admin@memory.flarelylegal.com",
        visibility: "private",
        description: "Demo namespace",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-06-01T00:00:00Z",
      },
      stats: {
        namespace_id: "ns-1",
        entity_count: 2,
        memory_count: 3,
        relation_count: 1,
        conversation_count: 1,
        message_count: 5,
        avg_importance: 0.9,
        archived_count: 0,
      },
      entities: [
        {
          id: "e-1",
          name: "Entity A",
          type: "concept",
          summary: "A concept",
          created_at: "2025-01-01T00:00:00Z",
        },
      ],
      memories: [
        {
          id: "m-1",
          content: "Something important",
          importance: 0.9,
          created_at: "2025-01-01T00:00:00Z",
        },
      ],
      relations: [
        { source_name: "Entity A", target_name: "Entity B", relation_type: "related_to" },
      ],
      conversations: [{ id: "c-1", title: "Chat 1", created_at: "2025-01-01T00:00:00Z" }],
    }).text();

    expect(html).toContain("Demo");
    expect(html).toContain("badge-private");
    expect(html).toContain("Entity A");
    expect(html).toContain("Something important");
    expect(html).toContain("related_to");
    expect(html).toContain("Chat 1");
    expect(html).toContain("/api/v1/entities/e-1");
  });

  it("renders empty sections", async () => {
    const html = await renderNamespaceDetail({
      namespace: {
        id: "ns-2",
        name: "Empty",
        owner: null,
        visibility: null,
        description: null,
        created_at: null,
        updated_at: null,
      },
      stats: {
        namespace_id: "ns-2",
        entity_count: 0,
        memory_count: 0,
        relation_count: 0,
        conversation_count: 0,
        message_count: 0,
        avg_importance: 0,
        archived_count: 0,
      },
      entities: [],
      memories: [],
      relations: [],
      conversations: [],
    }).text();

    expect(html).toContain("None");
  });
});

// ---------------------------------------------------------------------------
// Entity detail
// ---------------------------------------------------------------------------

describe("renderEntityDetail", () => {
  it("renders entity with relations and memories", async () => {
    const html = await renderEntityDetail({
      entity: {
        id: "e-1",
        namespace_id: "ns-1",
        namespace_name: "Demo",
        name: "Authentication",
        type: "concept",
        summary: "Handles user auth",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-06-01T00:00:00Z",
      },
      relations: [
        { id: "e-2", name: "D1", relation_type: "depends_on", direction: "outgoing" },
        { id: "e-3", name: "JWT", relation_type: "validates", direction: "incoming" },
      ],
      memories: [
        {
          id: "m-1",
          content: "Auth uses JWT tokens",
          importance: 0.8,
          created_at: "2025-01-01T00:00:00Z",
        },
      ],
    }).text();

    expect(html).toContain("Authentication");
    expect(html).toContain("concept");
    expect(html).toContain("Handles user auth");
    expect(html).toContain("D1");
    expect(html).toContain("depends_on");
    expect(html).toContain("Auth uses JWT tokens");
    expect(html).toContain("/api/v1/entities/e-2");
    expect(html).toContain("/api/v1/namespaces/ns-1");
    expect(html).toContain("Demo");
  });

  it("renders empty relations and memories", async () => {
    const html = await renderEntityDetail({
      entity: {
        id: "e-1",
        namespace_id: "ns-1",
        namespace_name: "Test",
        name: "Lonely",
        type: "thing",
        summary: null,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: null,
      },
      relations: [],
      memories: [],
    }).text();

    expect(html).toContain("None");
  });
});
