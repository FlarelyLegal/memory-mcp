import { describe, it, expect } from "vitest";
import {
  parseEntityRow,
  parseMemoryRow,
  parseRelationRow,
  parseConversationRow,
  parseMessageRow,
  parseNamespaceRow,
} from "../../src/api/row-parsers.js";
import type {
  EntityRow,
  MemoryRow,
  RelationRow,
  ConversationRow,
  MessageRow,
  NamespaceRow,
} from "../../src/types.js";

const TS = 1704067200; // 2024-01-01T00:00:00.000Z
const ISO = "2024-01-01T00:00:00.000Z";

describe("parseEntityRow", () => {
  const base: EntityRow = {
    id: "e1",
    namespace_id: "ns1",
    name: "Alice",
    type: "person",
    summary: null,
    metadata: '{"role":"admin"}',
    created_at: TS,
    updated_at: TS,
    last_accessed_at: TS,
    access_count: 5,
  };

  it("parses JSON metadata and converts timestamps", () => {
    const parsed = parseEntityRow(base);
    expect(parsed.metadata).toEqual({ role: "admin" });
    expect(parsed.created_at).toBe(ISO);
    expect(parsed.updated_at).toBe(ISO);
    expect(parsed.last_accessed_at).toBe(ISO);
    expect(parsed.access_count).toBe(5);
  });

  it("returns null metadata when metadata is null", () => {
    const parsed = parseEntityRow({ ...base, metadata: null });
    expect(parsed.metadata).toBeNull();
  });
});

describe("parseMemoryRow", () => {
  const base: MemoryRow = {
    id: "m1",
    namespace_id: "ns1",
    content: "some fact",
    type: "fact",
    source: "user",
    importance: 0.8,
    metadata: null,
    created_at: TS,
    updated_at: TS,
    last_accessed_at: TS,
    access_count: 1,
  };

  it("converts timestamps and handles null metadata", () => {
    const parsed = parseMemoryRow(base);
    expect(parsed.metadata).toBeNull();
    expect(parsed.created_at).toBe(ISO);
  });

  it("parses JSON metadata", () => {
    const parsed = parseMemoryRow({ ...base, metadata: '{"tag":"important"}' });
    expect(parsed.metadata).toEqual({ tag: "important" });
  });
});

describe("parseRelationRow", () => {
  const base: RelationRow = {
    id: "r1",
    namespace_id: "ns1",
    source_id: "e1",
    target_id: "e2",
    relation_type: "knows",
    weight: 0.9,
    metadata: null,
    created_at: TS,
    updated_at: TS,
  };

  it("converts timestamps", () => {
    const parsed = parseRelationRow(base);
    expect(parsed.created_at).toBe(ISO);
    expect(parsed.updated_at).toBe(ISO);
  });

  it("parses metadata", () => {
    const parsed = parseRelationRow({ ...base, metadata: '{"since":"2020"}' });
    expect(parsed.metadata).toEqual({ since: "2020" });
  });
});

describe("parseConversationRow", () => {
  const base: ConversationRow = {
    id: "c1",
    namespace_id: "ns1",
    title: "Test conv",
    metadata: null,
    created_at: TS,
    updated_at: TS,
  };

  it("converts timestamps and null metadata", () => {
    const parsed = parseConversationRow(base);
    expect(parsed.created_at).toBe(ISO);
    expect(parsed.metadata).toBeNull();
  });
});

describe("parseMessageRow", () => {
  const base: MessageRow = {
    id: "msg1",
    conversation_id: "c1",
    role: "user",
    content: "Hello",
    metadata: '{"tokens":5}',
    created_at: TS,
  };

  it("converts timestamp and parses metadata", () => {
    const parsed = parseMessageRow(base);
    expect(parsed.created_at).toBe(ISO);
    expect(parsed.metadata).toEqual({ tokens: 5 });
  });
});

describe("parseNamespaceRow", () => {
  const base: NamespaceRow = {
    id: "ns1",
    name: "Test",
    description: "desc",
    owner: "user@example.com",
    visibility: "private",
    metadata: null,
    created_at: TS,
    updated_at: TS,
  };

  it("converts timestamps and null metadata", () => {
    const parsed = parseNamespaceRow(base);
    expect(parsed.created_at).toBe(ISO);
    expect(parsed.updated_at).toBe(ISO);
    expect(parsed.metadata).toBeNull();
  });

  it("preserves non-timestamp fields", () => {
    const parsed = parseNamespaceRow(base);
    expect(parsed.name).toBe("Test");
    expect(parsed.owner).toBe("user@example.com");
    expect(parsed.visibility).toBe("private");
  });
});
