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
  groupRole,
  namespaceRole,
  groupPrivacy,
  memberStatus,
  groupNameField,
  groupDescriptionField,
  slugField,
} from "../../src/tool-schemas.js";

describe("field schemas", () => {
  it("nameField enforces bounds", () => {
    expect(nameField.safeParse("Alice").success).toBe(true);
    expect(nameField.safeParse("").success).toBe(false);
    expect(nameField.safeParse("a".repeat(201)).success).toBe(false);
    expect(nameField.safeParse("a".repeat(200)).success).toBe(true);
  });

  it("typeField and typeFilter enforce bounds", () => {
    expect(typeField.safeParse("person").success).toBe(true);
    expect(typeField.safeParse("").success).toBe(false);
    expect(typeField.safeParse("x".repeat(201)).success).toBe(false);
    expect(typeFilter.safeParse("").success).toBe(true);
    expect(typeFilter.safeParse("x".repeat(201)).success).toBe(false);
  });

  it("summaryField and descriptionField enforce max lengths", () => {
    expect(summaryField.safeParse("a".repeat(10_000)).success).toBe(true);
    expect(summaryField.safeParse("a".repeat(10_001)).success).toBe(false);
    expect(descriptionField.safeParse("a".repeat(2000)).success).toBe(true);
    expect(descriptionField.safeParse("a".repeat(2001)).success).toBe(false);
  });

  it("metadataObject validates object-only input", () => {
    expect(metadataObject.safeParse({ key: "val" }).success).toBe(true);
    expect(metadataObject.safeParse({ a: { b: 1 } }).success).toBe(true);
    expect(metadataObject.safeParse("string").success).toBe(false);
  });

  it("memoryContent and messageContent enforce min/max", () => {
    expect(memoryContent.safeParse("fact").success).toBe(true);
    expect(memoryContent.safeParse("").success).toBe(false);
    expect(memoryContent.safeParse("a".repeat(10_001)).success).toBe(false);
    expect(messageContent.safeParse("hello").success).toBe(true);
    expect(messageContent.safeParse("").success).toBe(false);
    expect(messageContent.safeParse("a".repeat(50_001)).success).toBe(false);
  });

  it("importance enforces range", () => {
    expect(importance.safeParse(0).success).toBe(true);
    expect(importance.safeParse(1).success).toBe(true);
    expect(importance.safeParse(0.5).success).toBe(true);
    expect(importance.safeParse(-0.1).success).toBe(false);
    expect(importance.safeParse(1.1).success).toBe(false);
  });

  it("sourceField enforces max length", () => {
    expect(sourceField.safeParse("a".repeat(500)).success).toBe(true);
    expect(sourceField.safeParse("a".repeat(501)).success).toBe(false);
  });

  it("entityIds validates UUID arrays and max size", () => {
    const uuids = Array.from({ length: 3 }, () => crypto.randomUUID());
    expect(entityIds.safeParse(uuids).success).toBe(true);
    expect(entityIds.safeParse(["not-uuid"]).success).toBe(false);
    expect(
      entityIds.safeParse(Array.from({ length: 101 }, () => crypto.randomUUID())).success,
    ).toBe(false);
  });

  it("queryField and relation schemas validate correctly", () => {
    expect(queryField.safeParse("search").success).toBe(true);
    expect(queryField.safeParse("").success).toBe(false);
    expect(queryField.safeParse("a".repeat(1001)).success).toBe(false);
    expect(relationType.safeParse("knows").success).toBe(true);
    expect(relationType.safeParse("").success).toBe(false);
    expect(relationWeight.safeParse(0.5).success).toBe(true);
    expect(relationWeight.safeParse(-1).success).toBe(false);
    expect(relationWeight.safeParse(2).success).toBe(false);
  });

  it("titleField enforces bounds", () => {
    expect(titleField.safeParse("My Title").success).toBe(true);
    expect(titleField.safeParse("").success).toBe(false);
    expect(titleField.safeParse("a".repeat(501)).success).toBe(false);
  });

  it("enum schemas validate accepted values", () => {
    for (const t of ["fact", "observation", "preference", "instruction"])
      expect(memoryType.safeParse(t).success).toBe(true);
    for (const r of ["user", "assistant", "system", "tool"])
      expect(messageRole.safeParse(r).success).toBe(true);
    for (const v of ["private", "public"]) expect(visibility.safeParse(v).success).toBe(true);
    for (const v of ["owner", "admin", "member"]) expect(groupRole.safeParse(v).success).toBe(true);
    for (const v of ["owner", "editor", "viewer"])
      expect(namespaceRole.safeParse(v).success).toBe(true);
    for (const v of ["visible", "hidden"]) expect(groupPrivacy.safeParse(v).success).toBe(true);
    for (const v of ["pending", "active", "suspended"])
      expect(memberStatus.safeParse(v).success).toBe(true);
    expect(groupRole.safeParse("invalid").success).toBe(false);
  });

  it("group fields validate expected formats", () => {
    expect(groupNameField.safeParse("User Name").success).toBe(true);
    expect(groupNameField.safeParse("").success).toBe(false);
    expect(groupDescriptionField.safeParse("a".repeat(2000)).success).toBe(true);
    expect(groupDescriptionField.safeParse("a".repeat(2001)).success).toBe(false);
    expect(slugField.safeParse("user-name").success).toBe(true);
    expect(slugField.safeParse("User Name").success).toBe(false);
  });
});
