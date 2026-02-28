import { describe, it, expect } from "vitest";
import {
  entityCreateSchema,
  entityUpdateSchema,
  relationCreateSchema,
  memoryCreateSchema,
  memoryUpdateSchema,
  messageCreateSchema,
  searchMessagesQuerySchema,
  semanticSearchSchema,
  serviceTokenBindRequestSchema,
  serviceTokenBindSelfSchema,
  serviceTokenLabelSchema,
  groupCreateSchema,
  groupUpdateSchema,
  groupMemberAddSchema,
  groupMemberRoleSchema,
  namespaceGrantCreateSchema,
} from "../../src/api/validators.js";

describe("REST validators", () => {
  it("entity create/update validators", () => {
    expect(entityCreateSchema.safeParse({ name: "Alice", type: "person" }).success).toBe(true);
    expect(entityCreateSchema.safeParse({ type: "person" }).success).toBe(false);
    expect(entityCreateSchema.safeParse({ name: "Alice" }).success).toBe(false);
    expect(entityUpdateSchema.safeParse({ name: "Bob" }).success).toBe(true);
    expect(entityUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("relation create validator", () => {
    const valid = {
      source_id: crypto.randomUUID(),
      target_id: crypto.randomUUID(),
      relation_type: "knows",
    };
    expect(relationCreateSchema.safeParse(valid).success).toBe(true);
    expect(
      relationCreateSchema.safeParse({ ...valid, weight: 0.8, metadata: { since: 2020 } }).success,
    ).toBe(true);
    expect(relationCreateSchema.safeParse({ ...valid, source_id: "bad" }).success).toBe(false);
  });

  it("memory create/update validators", () => {
    expect(memoryCreateSchema.safeParse({ content: "fact" }).success).toBe(true);
    expect(
      memoryCreateSchema.safeParse({
        content: "fact",
        type: "fact",
        importance: 0.9,
        source: "user",
        entity_ids: [crypto.randomUUID()],
        metadata: { tag: "x" },
      }).success,
    ).toBe(true);
    expect(memoryCreateSchema.safeParse({ content: "" }).success).toBe(false);
    expect(memoryUpdateSchema.safeParse({ importance: 0.5 }).success).toBe(true);
    expect(memoryUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("message and message search validators", () => {
    expect(messageCreateSchema.safeParse({ role: "user", content: "hello" }).success).toBe(true);
    expect(messageCreateSchema.safeParse({ role: "bot", content: "hello" }).success).toBe(false);
    expect(searchMessagesQuerySchema.safeParse({ q: "test" }).success).toBe(true);
    expect(searchMessagesQuerySchema.safeParse({}).success).toBe(false);
  });

  it("semantic search validator", () => {
    expect(semanticSearchSchema.safeParse({ query: "test" }).success).toBe(true);
    expect(
      semanticSearchSchema.safeParse({
        query: "test",
        mode: "context",
        kind: "entity",
        type: "person",
        after: 1000,
        before: 2000,
        role: "user",
        conversation_id: crypto.randomUUID(),
        limit: 5,
      }).success,
    ).toBe(true);
    const coerced = semanticSearchSchema.safeParse({ query: "test", limit: "5" });
    expect(coerced.success).toBe(true);
    if (coerced.success) expect(coerced.data.limit).toBe(5);
    expect(semanticSearchSchema.safeParse({ query: "test", limit: 21 }).success).toBe(false);
  });

  it("service token validators", () => {
    expect(serviceTokenBindRequestSchema.safeParse({ common_name: "abc123.access" }).success).toBe(
      true,
    );
    expect(serviceTokenBindRequestSchema.safeParse({ common_name: "bad-format" }).success).toBe(
      false,
    );
    expect(
      serviceTokenBindSelfSchema.safeParse({ challenge_id: crypto.randomUUID() }).success,
    ).toBe(true);
    expect(serviceTokenBindSelfSchema.safeParse({ challenge_id: "bad" }).success).toBe(false);
    expect(serviceTokenLabelSchema.safeParse({ label: "My Token" }).success).toBe(true);
    expect(serviceTokenLabelSchema.safeParse({ label: "" }).success).toBe(false);
    expect(serviceTokenLabelSchema.safeParse({ label: "a".repeat(201) }).success).toBe(false);
  });

  it("group and grant validators", () => {
    expect(groupCreateSchema.safeParse({ name: "User Name", slug: "user-name" }).success).toBe(
      true,
    );
    expect(groupUpdateSchema.safeParse({}).success).toBe(false);
    expect(groupMemberAddSchema.safeParse({ email: "user@memory.flarelylegal.com" }).success).toBe(
      true,
    );
    expect(groupMemberRoleSchema.safeParse({ role: "admin" }).success).toBe(true);
    expect(
      namespaceGrantCreateSchema.safeParse({
        email: "user@memory.flarelylegal.com",
        role: "viewer",
      }).success,
    ).toBe(true);
    expect(
      namespaceGrantCreateSchema.safeParse({
        email: "user@memory.flarelylegal.com",
        group_id: crypto.randomUUID(),
        role: "viewer",
      }).success,
    ).toBe(false);
  });
});
