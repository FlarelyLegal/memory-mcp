/** Runtime validators for REST API inputs. */
import { z } from "zod";
import {
  nameField,
  groupNameField,
  groupDescriptionField,
  slugField,
  groupPrivacy,
  groupRole,
  memberStatus,
  namespaceRole,
  typeField,
  typeFilter,
  summaryField,
  metadataObject,
  memoryContent,
  memoryType,
  importance,
  sourceField,
  entityIds,
  messageRole,
  messageContent,
  queryField,
  relationType,
  relationWeight,
  SEARCH_MODES,
  SEARCH_KINDS,
} from "../tool-schemas.js";

export const entityListQuerySchema = z.object({
  q: queryField.optional(),
  type: typeFilter.optional(),
});

export const entityCreateSchema = z.object({
  name: nameField,
  type: typeField,
  summary: summaryField.optional(),
  metadata: metadataObject.optional(),
});

export const entityUpdateSchema = z
  .object({
    name: nameField.optional(),
    type: typeField.optional(),
    summary: summaryField.optional(),
    metadata: metadataObject.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const relationCreateSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation_type: relationType,
  weight: relationWeight.optional(),
  metadata: metadataObject.optional(),
});

export const memoryCreateSchema = z.object({
  content: memoryContent,
  type: memoryType.optional(),
  importance: importance.optional(),
  source: sourceField.optional(),
  entity_ids: entityIds.optional(),
  metadata: metadataObject.optional(),
});

export const memoryUpdateSchema = z
  .object({
    content: memoryContent.optional(),
    type: memoryType.optional(),
    importance: importance.optional(),
    metadata: metadataObject.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const messageCreateSchema = z.object({
  role: messageRole,
  content: messageContent,
  metadata: metadataObject.optional(),
});

export const searchMessagesQuerySchema = z.object({
  q: queryField,
});

export const semanticSearchSchema = z.object({
  query: queryField,
  mode: z.enum(SEARCH_MODES).optional(),
  kind: z.enum(SEARCH_KINDS).optional(),
  type: typeFilter.optional(),
  after: z.coerce.number().int().optional(),
  before: z.coerce.number().int().optional(),
  role: messageRole.optional(),
  conversation_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export const serviceTokenBindRequestSchema = z.object({
  common_name: z.string().regex(/^[a-z0-9]+\.access$/, "Invalid common_name format"),
  label: z.string().max(200).optional(),
});

export const serviceTokenBindSelfSchema = z.object({
  challenge_id: z.string().uuid(),
});

export const serviceTokenLabelSchema = z.object({
  label: z.string().min(1).max(200),
});

export const groupCreateSchema = z.object({
  name: groupNameField,
  slug: slugField.optional(),
  description: groupDescriptionField.optional(),
  privacy: groupPrivacy.optional(),
  parent_group_id: z.string().uuid().nullable().optional(),
});

export const groupUpdateSchema = z
  .object({
    name: groupNameField.optional(),
    slug: slugField.optional(),
    description: groupDescriptionField.optional(),
    privacy: groupPrivacy.optional(),
    parent_group_id: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const groupMemberAddSchema = z.object({
  email: z.string().email().max(320),
  role: groupRole.optional(),
  status: memberStatus.optional(),
});

export const groupMemberRoleSchema = z.object({ role: groupRole });

export const namespaceGrantCreateSchema = z
  .object({
    email: z.string().email().max(320).optional(),
    group_id: z.string().uuid().optional(),
    role: namespaceRole,
    expires_at: z.number().int().optional(),
  })
  .refine((v) => !!v.email !== !!v.group_id, "Set exactly one of email or group_id");
