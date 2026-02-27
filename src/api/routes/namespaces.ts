/** Namespace REST endpoints + OpenAPI definitions. */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import { createNamespace, listNamespaces } from "../../graph/index.js";
import { namespaceSchema } from "../schemas.js";
import { parseFields, projectRows } from "../fields.js";

export function registerNamespaceRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces",
    async (ctx) => {
      try {
        const fields = parseFields(ctx.query, [
          "id",
          "name",
          "description",
          "owner",
          "metadata",
          "created_at",
          "updated_at",
        ]);
        const rows = await listNamespaces(ctx.env.DB, ctx.email);
        return json(projectRows(rows, fields));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List namespaces",
      description: "List all namespaces owned by the authenticated user.",
      tags: ["Namespaces"],
      operationId: "listNamespaces",
      parameters: [
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

        const id = await createNamespace(ctx.env.DB, {
          name: body.name,
          description: body.description,
          owner: ctx.email,
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
            schema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", maxLength: 200 },
                description: { type: "string", maxLength: 2000 },
              },
            },
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
