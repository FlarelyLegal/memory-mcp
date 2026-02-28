/** Namespace collection REST endpoints (list + create). */
import { z } from "zod";
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import { createNamespace, listNamespaces } from "../../graph/index.js";
import { nameField, descriptionField } from "../../tool-schemas.js";
import { namespaceSchema, zodSchema } from "../schemas.js";
import { parseFields, parseCursor, nextCursor, projectRows } from "../fields.js";
import { parseNamespaceRow } from "../row-parsers.js";
import { audit } from "../../audit.js";
import { bustIdentityCache } from "../../cache-bust.js";

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
          "shard_id",
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
        const rows = await listNamespaces(ctx.db, ctx.identity, { limit: limit + 1, offset });
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
        await bustIdentityCache(ctx.env.USERS, ctx.email);
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
}
