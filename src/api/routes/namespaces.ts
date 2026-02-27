/** Namespace REST endpoints + OpenAPI definitions. */
import { z } from "zod";
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import {
  createNamespace,
  listNamespaces,
  updateNamespaceVisibility,
  collectNamespaceVectorIds,
  deleteNamespace,
} from "../../graph/index.js";
import { deleteVectorBatch } from "../../vectorize.js";
import { assertNamespaceWriteAccess, isAdmin } from "../../auth.js";
import { nameField, descriptionField, visibility } from "../../tool-schemas.js";
import { namespaceSchema, okSchema, zodSchema } from "../schemas.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";
import { parseNamespaceRow } from "../row-parsers.js";
import { audit } from "../../audit.js";
import type { NamespaceVisibility } from "../../types.js";

export function registerNamespaceRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces",
    async (ctx) => {
      try {
        const allowed = [
          "id",
          "name",
          "description",
          "owner",
          "visibility",
          "metadata",
          "created_at",
          "updated_at",
        ] as const;
        const fields = parseFields(ctx.query, allowed, {
          compact: ["id", "name"],
          full: allowed,
        });
        const limit = 50;
        const offset = parseCursor(ctx.query);
        const rows = await listNamespaces(ctx.db, ctx.email, { limit: limit + 1, offset });
        const hasMore = rows.length > limit;
        const data = projectRows(rows.slice(0, limit).map(parseNamespaceRow), fields);
        const response = json(data);
        const cursor = nextCursor(offset, limit, hasMore);
        if (cursor) response.headers.set("X-Next-Cursor", cursor);
        return response;
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List namespaces",
      description: "List namespaces owned by the user plus public namespaces.",
      tags: ["Namespaces"],
      operationId: "listNamespaces",
      parameters: [
        {
          name: "cursor",
          in: "query",
          description: "Opaque pagination cursor from X-Next-Cursor",
          schema: { type: "string" },
        },
        {
          name: "fields",
          in: "query",
          description: "Comma-separated fields to include",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Array of namespaces",
          content: {
            "application/json": { schema: { type: "array", items: namespaceSchema() } },
          },
        },
      },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/namespaces",
    async (ctx, request) => {
      try {
        const body = await parseBody<{ name?: string; description?: string }>(request);
        if (body instanceof Response) return body;
        if (!body.name) return jsonError("name is required", 400);

        const id = await createNamespace(ctx.db, {
          name: body.name,
          description: body.description,
          owner: ctx.email,
        });
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "namespace.create",
          email: ctx.email,
          namespace_id: id,
          resource_type: "namespace",
          resource_id: id,
          detail: { name: body.name },
        });
        return json({ id, name: body.name }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create namespace",
      description: "Create a new memory namespace.",
      tags: ["Namespaces"],
      operationId: "createNamespace",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: zodSchema(
              z.object({ name: nameField, description: descriptionField.optional() }),
            ),
          },
        },
      },
      responses: {
        "201": {
          description: "Namespace created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { id: { type: "string" }, name: { type: "string" } },
              },
            },
          },
        },
      },
    },
  );

  defineRoute(
    "PATCH",
    "/api/v1/namespaces/:id",
    async (ctx, request) => {
      try {
        if (!(await isAdmin(ctx.env.CACHE, ctx.email)))
          return jsonError("Admin access required", 403);
        await assertNamespaceWriteAccess(ctx.db, ctx.params.id, ctx.email, true);
        const body = await parseBody<{ visibility?: string }>(request);
        if (body instanceof Response) return body;
        const v = body.visibility;
        if (!v || (v !== "private" && v !== "public"))
          return jsonError("visibility must be 'private' or 'public'", 400);
        await updateNamespaceVisibility(ctx.db, ctx.params.id, v as NamespaceVisibility);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "namespace.set_visibility",
          email: ctx.email,
          namespace_id: ctx.params.id,
          resource_type: "namespace",
          resource_id: ctx.params.id,
          detail: { visibility: v },
        });
        return json({ ok: true, visibility: v });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Update namespace visibility",
      description: "Set namespace visibility to public or private. Admin only.",
      tags: ["Namespaces"],
      operationId: "updateNamespaceVisibility",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Namespace ID",
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: zodSchema(z.object({ visibility })) },
        },
      },
      responses: {
        "200": {
          description: "Updated",
          content: { "application/json": { schema: okSchema() } },
        },
      },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/namespaces/:id",
    async (ctx) => {
      try {
        const admin = await isAdmin(ctx.env.CACHE, ctx.email);
        const ns = await assertNamespaceWriteAccess(ctx.db, ctx.params.id, ctx.email, admin);
        const vectorIds = await collectNamespaceVectorIds(ctx.db, ctx.params.id);
        await deleteNamespace(ctx.db, ctx.params.id);
        await deleteVectorBatch(ctx.env, vectorIds);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "namespace.delete",
          email: ctx.email,
          namespace_id: ctx.params.id,
          resource_type: "namespace",
          resource_id: ctx.params.id,
          detail: { name: ns.name, vectors_deleted: vectorIds.length },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Delete namespace",
      description:
        "Delete a namespace and all its contents (entities, relations, memories, conversations, messages). Vectors are removed from Vectorize. Owner or admin required.",
      tags: ["Namespaces"],
      operationId: "deleteNamespace",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Namespace ID",
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": {
          description: "Deleted",
          content: { "application/json": { schema: okSchema() } },
        },
      },
    },
  );
}
