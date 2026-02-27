/** Tier 2: Schema validation tests for tool-schemas and api/validators. */
import { describe, it, expect } from "vitest";
import {
  nameField,
  typeField,
  typeFilter,
  summaryField,
  descriptionField,
  metadataObject,
  memoryContent,
  messageContent,
  importance,
  sourceField,
  entityIds,
  queryField,
  relationType,
  relationWeight,
  titleField,
  memoryType,
  messageRole,
  visibility,
} from "../../src/tool-schemas.js";
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
} from "../../src/api/validators.js";

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

describe("field schemas", () => {
  describe("nameField", () => {
    it("accepts valid name", () => expect(nameField.safeParse("Alice").success).toBe(true));
    it("rejects empty string", () => expect(nameField.safeParse("").success).toBe(false));
    it("rejects over 200 chars", () =>
      expect(nameField.safeParse("a".repeat(201)).success).toBe(false));
    it("accepts exactly 200 chars", () =>
      expect(nameField.safeParse("a".repeat(200)).success).toBe(true));
  });

  describe("typeField", () => {
    it("accepts valid type", () => expect(typeField.safeParse("person").success).toBe(true));
    it("rejects empty", () => expect(typeField.safeParse("").success).toBe(false));
    it("rejects over 200", () => expect(typeField.safeParse("x".repeat(201)).success).toBe(false));
  });

  describe("typeFilter", () => {
    it("accepts empty string (filter disabled)", () =>
      expect(typeFilter.safeParse("").success).toBe(true));
    it("rejects over 200", () => expect(typeFilter.safeParse("x".repeat(201)).success).toBe(false));
  });

  describe("summaryField", () => {
    it("accepts long text", () =>
      expect(summaryField.safeParse("a".repeat(10_000)).success).toBe(true));
    it("rejects over 10000", () =>
      expect(summaryField.safeParse("a".repeat(10_001)).success).toBe(false));
  });

  describe("descriptionField", () => {
    it("accepts up to 2000", () =>
      expect(descriptionField.safeParse("a".repeat(2000)).success).toBe(true));
    it("rejects over 2000", () =>
      expect(descriptionField.safeParse("a".repeat(2001)).success).toBe(false));
  });

  describe("metadataObject", () => {
    it("accepts plain object", () =>
      expect(metadataObject.safeParse({ key: "val" }).success).toBe(true));
    it("rejects string", () => expect(metadataObject.safeParse("string").success).toBe(false));
    it("accepts nested objects", () =>
      expect(metadataObject.safeParse({ a: { b: 1 } }).success).toBe(true));
  });

  describe("memoryContent", () => {
    it("accepts valid content", () =>
      expect(memoryContent.safeParse("some fact").success).toBe(true));
    it("rejects empty", () => expect(memoryContent.safeParse("").success).toBe(false));
    it("rejects over 10000", () =>
      expect(memoryContent.safeParse("a".repeat(10_001)).success).toBe(false));
  });

  describe("messageContent", () => {
    it("accepts valid content", () => expect(messageContent.safeParse("hello").success).toBe(true));
    it("rejects empty", () => expect(messageContent.safeParse("").success).toBe(false));
    it("rejects over 50000", () =>
      expect(messageContent.safeParse("a".repeat(50_001)).success).toBe(false));
  });

  describe("importance", () => {
    it("accepts 0", () => expect(importance.safeParse(0).success).toBe(true));
    it("accepts 1", () => expect(importance.safeParse(1).success).toBe(true));
    it("accepts 0.5", () => expect(importance.safeParse(0.5).success).toBe(true));
    it("rejects negative", () => expect(importance.safeParse(-0.1).success).toBe(false));
    it("rejects >1", () => expect(importance.safeParse(1.1).success).toBe(false));
  });

  describe("sourceField", () => {
    it("accepts up to 500", () =>
      expect(sourceField.safeParse("a".repeat(500)).success).toBe(true));
    it("rejects over 500", () =>
      expect(sourceField.safeParse("a".repeat(501)).success).toBe(false));
  });

  describe("entityIds", () => {
    it("accepts array of UUIDs", () => {
      const uuids = Array.from({ length: 3 }, () => crypto.randomUUID());
      expect(entityIds.safeParse(uuids).success).toBe(true);
    });
    it("rejects non-UUID strings", () =>
      expect(entityIds.safeParse(["not-uuid"]).success).toBe(false));
    it("rejects over 100 items", () => {
      const uuids = Array.from({ length: 101 }, () => crypto.randomUUID());
      expect(entityIds.safeParse(uuids).success).toBe(false);
    });
  });

  describe("queryField", () => {
    it("accepts valid query", () => expect(queryField.safeParse("search").success).toBe(true));
    it("rejects empty", () => expect(queryField.safeParse("").success).toBe(false));
    it("rejects over 1000", () =>
      expect(queryField.safeParse("a".repeat(1001)).success).toBe(false));
  });

  describe("relationType", () => {
    it("accepts valid", () => expect(relationType.safeParse("knows").success).toBe(true));
    it("rejects empty", () => expect(relationType.safeParse("").success).toBe(false));
  });

  describe("relationWeight", () => {
    it("accepts 0-1 range", () => expect(relationWeight.safeParse(0.5).success).toBe(true));
    it("rejects negative", () => expect(relationWeight.safeParse(-1).success).toBe(false));
    it("rejects >1", () => expect(relationWeight.safeParse(2).success).toBe(false));
  });

  describe("titleField", () => {
    it("accepts valid", () => expect(titleField.safeParse("My Title").success).toBe(true));
    it("rejects empty", () => expect(titleField.safeParse("").success).toBe(false));
    it("rejects over 500", () => expect(titleField.safeParse("a".repeat(501)).success).toBe(false));
  });

  describe("enum schemas", () => {
    it("memoryType accepts valid values", () => {
      for (const t of ["fact", "observation", "preference", "instruction"])
        expect(memoryType.safeParse(t).success).toBe(true);
      expect(memoryType.safeParse("invalid").success).toBe(false);
    });

    it("messageRole accepts valid values", () => {
      for (const r of ["user", "assistant", "system", "tool"])
        expect(messageRole.safeParse(r).success).toBe(true);
      expect(messageRole.safeParse("invalid").success).toBe(false);
    });

    it("visibility accepts valid values", () => {
      for (const v of ["private", "public"]) expect(visibility.safeParse(v).success).toBe(true);
      expect(visibility.safeParse("invalid").success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// REST API validators
// ---------------------------------------------------------------------------

describe("REST validators", () => {
  describe("entityCreateSchema", () => {
    it("accepts valid payload", () => {
      expect(entityCreateSchema.safeParse({ name: "Alice", type: "person" }).success).toBe(true);
    });

    it("accepts with optional fields", () => {
      const r = entityCreateSchema.safeParse({
        name: "Alice",
        type: "person",
        summary: "A person",
        metadata: { role: "admin" },
      });
      expect(r.success).toBe(true);
    });

    it("rejects missing name", () => {
      expect(entityCreateSchema.safeParse({ type: "person" }).success).toBe(false);
    });

    it("rejects missing type", () => {
      expect(entityCreateSchema.safeParse({ name: "Alice" }).success).toBe(false);
    });
  });

  describe("entityUpdateSchema", () => {
    it("accepts single field update", () => {
      expect(entityUpdateSchema.safeParse({ name: "Bob" }).success).toBe(true);
    });

    it("rejects empty object", () => {
      expect(entityUpdateSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("relationCreateSchema", () => {
    const valid = {
      source_id: crypto.randomUUID(),
      target_id: crypto.randomUUID(),
      relation_type: "knows",
    };

    it("accepts valid payload", () => {
      expect(relationCreateSchema.safeParse(valid).success).toBe(true);
    });

    it("accepts optional weight and metadata", () => {
      expect(
        relationCreateSchema.safeParse({ ...valid, weight: 0.8, metadata: { since: 2020 } })
          .success,
      ).toBe(true);
    });

    it("rejects non-UUID source_id", () => {
      expect(relationCreateSchema.safeParse({ ...valid, source_id: "bad" }).success).toBe(false);
    });
  });

  describe("memoryCreateSchema", () => {
    it("accepts valid payload", () => {
      expect(memoryCreateSchema.safeParse({ content: "fact" }).success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const r = memoryCreateSchema.safeParse({
        content: "fact",
        type: "fact",
        importance: 0.9,
        source: "user",
        entity_ids: [crypto.randomUUID()],
        metadata: { tag: "x" },
      });
      expect(r.success).toBe(true);
    });

    it("rejects empty content", () => {
      expect(memoryCreateSchema.safeParse({ content: "" }).success).toBe(false);
    });
  });

  describe("memoryUpdateSchema", () => {
    it("accepts single field update", () => {
      expect(memoryUpdateSchema.safeParse({ importance: 0.5 }).success).toBe(true);
    });

    it("rejects empty object", () => {
      expect(memoryUpdateSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("messageCreateSchema", () => {
    it("accepts valid payload", () => {
      expect(messageCreateSchema.safeParse({ role: "user", content: "hello" }).success).toBe(true);
    });

    it("rejects invalid role", () => {
      expect(messageCreateSchema.safeParse({ role: "bot", content: "hello" }).success).toBe(false);
    });
  });

  describe("searchMessagesQuerySchema", () => {
    it("accepts valid query", () => {
      expect(searchMessagesQuerySchema.safeParse({ q: "test" }).success).toBe(true);
    });

    it("rejects missing q", () => {
      expect(searchMessagesQuerySchema.safeParse({}).success).toBe(false);
    });
  });

  describe("semanticSearchSchema", () => {
    it("accepts minimal payload", () => {
      expect(semanticSearchSchema.safeParse({ query: "test" }).success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const r = semanticSearchSchema.safeParse({
        query: "test",
        mode: "context",
        kind: "entity",
        type: "person",
        after: 1000,
        before: 2000,
        role: "user",
        conversation_id: crypto.randomUUID(),
        limit: 5,
      });
      expect(r.success).toBe(true);
    });

    it("coerces string limit to number", () => {
      const r = semanticSearchSchema.safeParse({ query: "test", limit: "5" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.limit).toBe(5);
    });

    it("rejects limit > 20", () => {
      expect(semanticSearchSchema.safeParse({ query: "test", limit: 21 }).success).toBe(false);
    });
  });

  describe("serviceTokenBindRequestSchema", () => {
    it("accepts valid common_name", () => {
      expect(
        serviceTokenBindRequestSchema.safeParse({ common_name: "abc123.access" }).success,
      ).toBe(true);
    });

    it("rejects invalid common_name format", () => {
      expect(serviceTokenBindRequestSchema.safeParse({ common_name: "bad-format" }).success).toBe(
        false,
      );
    });
  });

  describe("serviceTokenBindSelfSchema", () => {
    it("accepts valid UUID", () => {
      expect(
        serviceTokenBindSelfSchema.safeParse({ challenge_id: crypto.randomUUID() }).success,
      ).toBe(true);
    });

    it("rejects non-UUID", () => {
      expect(serviceTokenBindSelfSchema.safeParse({ challenge_id: "bad" }).success).toBe(false);
    });
  });

  describe("serviceTokenLabelSchema", () => {
    it("accepts valid label", () => {
      expect(serviceTokenLabelSchema.safeParse({ label: "My Token" }).success).toBe(true);
    });

    it("rejects empty label", () => {
      expect(serviceTokenLabelSchema.safeParse({ label: "" }).success).toBe(false);
    });

    it("rejects over 200 chars", () => {
      expect(serviceTokenLabelSchema.safeParse({ label: "a".repeat(201) }).success).toBe(false);
    });
  });
});
