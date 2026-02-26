/** Entity list + create REST endpoints + OpenAPI definitions. */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import { createEntity, searchEntities } from "../../graph/index.js";
import { assertNamespaceAccess } from "../../auth.js";
import { upsertEntityVector } from "../../embeddings.js";
import {
  nsPathParam,
  limitQueryParam,
  queryLimit,
  entitySchema,
  metadataSchema,
} from "../schemas.js";
import { parseEntityRow } from "../row-parsers.js";

export function registerEntityRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces/:namespace_id/entities",
    async (ctx) => {
      try {
        await assertNamespaceAccess(ctx.env.DB, ctx.params.namespace_id, ctx.email);
        const query = ctx.query.get("q") ?? undefined;
        const type = ctx.query.get("type") ?? undefined;
        const limit = queryLimit(ctx.query, 50);
        const rows = await searchEntities(ctx.env.DB, ctx.params.namespace_id, {
          query,
          type,
          limit,
        });
        return json(rows.map(parseEntityRow));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List / search entities",
      description: "Search entities by name, type, or keyword in a namespace.",
      tags: ["Entities"],
      operationId: "listEntities",
      parameters: [
        nsPathParam(),
        { name: "q", in: "query", description: "Search query", schema: { type: "string" } },
        {
          name: "type",
          in: "query",
          description: "Filter by entity type",
          schema: { type: "string" },
        },
        limitQueryParam(50),
      ],
      responses: {
        "200": {
          description: "Array of entities",
          content: {
            "application/json": { schema: { type: "array", items: entitySchema() } },
          },
        },
      },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/namespaces/:namespace_id/entities",
    async (ctx, request) => {
      try {
        await assertNamespaceAccess(ctx.env.DB, ctx.params.namespace_id, ctx.email);
        const body = await parseBody<{
          name?: string;
          type?: string;
          summary?: string;
          metadata?: Record<string, unknown>;
        }>(request);
        if (body instanceof Response) return body;
        if (!body.name || !body.type) return jsonError("name and type are required", 400);

        const id = await createEntity(ctx.env.DB, {
          namespace_id: ctx.params.namespace_id,
          name: body.name,
          type: body.type,
          summary: body.summary,
          metadata: body.metadata,
        });
        await upsertEntityVector(ctx.env, {
          entity_id: id,
          namespace_id: ctx.params.namespace_id,
          name: body.name,
          type: body.type,
          summary: body.summary ?? null,
        });
        return json({ id, name: body.name, type: body.type }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create entity",
      description: "Create a graph entity and embed it for semantic search.",
      tags: ["Entities"],
      operationId: "createEntity",
      parameters: [nsPathParam()],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "type"],
              properties: {
                name: { type: "string", maxLength: 200 },
                type: {
                  type: "string",
                  maxLength: 200,
                  description: "e.g. person, concept, project",
                },
                summary: { type: "string", maxLength: 10000 },
                metadata: metadataSchema(),
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Entity created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  type: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  );
}
