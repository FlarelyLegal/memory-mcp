/** Runtime validators for REST API inputs. */
import { z } from "zod";

const metadata = z.record(z.string(), z.unknown());
const memoryType = z.enum(["fact", "observation", "preference", "instruction"]);
const messageRole = z.enum(["user", "assistant", "system", "tool"]);

export const entityListQuerySchema = z.object({
  q: z.string().max(1000).optional(),
  type: z.string().max(200).optional(),
});

export const entityCreateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
  summary: z.string().max(10_000).optional(),
  metadata: metadata.optional(),
});

export const entityUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    type: z.string().min(1).max(200).optional(),
    summary: z.string().max(10_000).optional(),
    metadata: metadata.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const relationCreateSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation_type: z.string().min(1).max(200),
  weight: z.number().min(0).max(1).optional(),
  metadata: metadata.optional(),
});

export const memoryCreateSchema = z.object({
  content: z.string().min(1).max(10_000),
  type: memoryType.optional(),
  importance: z.number().min(0).max(1).optional(),
  source: z.string().max(500).optional(),
  entity_ids: z.array(z.string().uuid()).max(100).optional(),
  metadata: metadata.optional(),
});

export const memoryUpdateSchema = z
  .object({
    content: z.string().min(1).max(10_000).optional(),
    type: memoryType.optional(),
    importance: z.number().min(0).max(1).optional(),
    metadata: metadata.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const messageCreateSchema = z.object({
  role: messageRole,
  content: z.string().min(1).max(50_000),
  metadata: metadata.optional(),
});

export const searchMessagesQuerySchema = z.object({
  q: z.string().min(1).max(1000),
});

export const semanticSearchSchema = z.object({
  query: z.string().min(1).max(1000),
  mode: z.enum(["semantic", "context"]).optional(),
  kind: z.enum(["entity", "memory", "message"]).optional(),
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
