/** Workflow REST endpoints: reindex, consolidation, status + OpenAPI defs. */
import { z } from "zod";
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import { assertNamespaceWriteAccess, isAdmin } from "../../auth.js";
import { consolidateFields, WORKFLOW_TYPES } from "../../tool-schemas.js";
import { zodSchema } from "../schemas.js";
import { audit } from "../../audit.js";

/** Shared 202 response schema for workflow creation endpoints. */
const workflowCreatedResponse = {
  "202": {
    description: "Workflow instance created",
    content: {
      "application/json": {
        schema: {
          type: "object" as const,
          properties: { instance_id: { type: "string" }, status: { type: "string" } },
        },
      },
    },
  },
};

export function registerWorkflowRoutes(): void {
  // --- Reindex (workflow) ---
  defineRoute(
    "POST",
    "/api/v1/admin/reindex",
    async (ctx, request) => {
      try {
        if (!(await isAdmin(ctx.env.CACHE, ctx.email)))
          return jsonError("Admin access required", 403);
        const body = await parseBody<{ namespace_id?: string }>(request);
        if (body instanceof Response) return body;
        if (!body.namespace_id) return jsonError("namespace_id is required", 400);

        if (body.namespace_id !== "all") {
          await assertNamespaceWriteAccess(ctx.db, body.namespace_id, ctx.email, true);
        }

        const instance = await ctx.env.REINDEX_WORKFLOW.create({
          params: { namespace_id: body.namespace_id, email: ctx.email },
        });

        await audit(ctx.db, ctx.env.STORAGE, {
          action: "workflow.reindex",
          email: ctx.email,
          namespace_id: body.namespace_id === "all" ? null : body.namespace_id,
          resource_type: "workflow",
          resource_id: instance.id,
          detail: { namespace_id: body.namespace_id },
        });
        return json({ instance_id: instance.id, status: "queued" }, 202);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Reindex vectors",
      description:
        "Start a durable Workflow to re-embed all entities and memories into Vectorize. Returns instance ID for status tracking.",
      tags: ["Admin"],
      operationId: "reindexVectors",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["namespace_id"],
              properties: {
                namespace_id: {
                  type: "string",
                  description: 'Namespace ID, or "all" for all owned namespaces',
                },
              },
            },
          },
        },
      },
      responses: workflowCreatedResponse,
    },
  );

  // --- Consolidation (workflow) ---
  defineRoute(
    "POST",
    "/api/v1/admin/consolidate",
    async (ctx, request) => {
      try {
        if (!(await isAdmin(ctx.env.CACHE, ctx.email)))
          return jsonError("Admin access required", 403);
        const body = await parseBody<{
          namespace_id?: string;
          decay_threshold?: number;
          skip_merge?: boolean;
          merge_threshold?: number;
          skip_summaries?: boolean;
          purge_after_days?: number;
        }>(request);
        if (body instanceof Response) return body;
        if (!body.namespace_id) return jsonError("namespace_id is required", 400);

        await assertNamespaceWriteAccess(ctx.db, body.namespace_id, ctx.email, true);

        const instance = await ctx.env.CONSOLIDATION_WORKFLOW.create({
          params: {
            namespace_id: body.namespace_id,
            email: ctx.email,
            decay_threshold: body.decay_threshold,
            skip_merge: body.skip_merge,
            merge_threshold: body.merge_threshold,
            skip_summaries: body.skip_summaries,
            purge_after_days: body.purge_after_days,
          },
        });

        await audit(ctx.db, ctx.env.STORAGE, {
          action: "workflow.consolidate",
          email: ctx.email,
          namespace_id: body.namespace_id,
          resource_type: "workflow",
          resource_id: instance.id,
          detail: {
            decay_threshold: body.decay_threshold,
            skip_merge: body.skip_merge,
            merge_threshold: body.merge_threshold,
            skip_summaries: body.skip_summaries,
            purge_after_days: body.purge_after_days,
          },
        });
        return json({ instance_id: instance.id, status: "queued" }, 202);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Consolidate memory",
      description:
        "Start a durable Workflow for memory consolidation: decay sweep, duplicate removal, memory merge, AI summary refresh, and purge.",
      tags: ["Admin"],
      operationId: "consolidateMemory",
      requestBody: {
        required: true,
        content: { "application/json": { schema: zodSchema(z.object(consolidateFields)) } },
      },
      responses: workflowCreatedResponse,
    },
  );

  // --- Workflow status ---
  defineRoute(
    "GET",
    "/api/v1/admin/workflows/:workflow/:instance_id",
    async (ctx) => {
      try {
        if (!(await isAdmin(ctx.env.CACHE, ctx.email)))
          return jsonError("Admin access required", 403);
        const { workflow, instance_id } = ctx.params;
        const binding =
          workflow === "reindex"
            ? ctx.env.REINDEX_WORKFLOW
            : workflow === "consolidation"
              ? ctx.env.CONSOLIDATION_WORKFLOW
              : null;
        if (!binding) return jsonError("Unknown workflow type", 400);

        const instance = await binding.get(instance_id);
        const status = await instance.status();
        return json(status);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Workflow status",
      description: "Get the status of a reindex or consolidation workflow instance.",
      tags: ["Admin"],
      operationId: "getWorkflowStatus",
      parameters: [
        {
          name: "workflow",
          in: "path",
          required: true,
          description: "Workflow type",
          schema: { type: "string", enum: [...WORKFLOW_TYPES] },
        },
        {
          name: "instance_id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Workflow instance status",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string" },
                  output: { type: "object" },
                  error: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
  );
}
