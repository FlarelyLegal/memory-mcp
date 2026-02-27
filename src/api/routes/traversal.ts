/** Graph traversal REST endpoint + OpenAPI definition. */
import { defineRoute } from "../registry.js";
import { json, handleError } from "../middleware.js";
import { traverse } from "../../graph/index.js";
import { assertEntityAccess } from "../../auth.js";
import { parseEntityRow, parseRelationRow } from "../row-parsers.js";

export function registerTraversalRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/entities/:id/traverse",
    async (ctx) => {
      try {
        await assertEntityAccess(ctx.db, ctx.params.id, ctx.email);
        const maxDepth = Math.min(Number(ctx.query.get("max_depth") ?? 2), 5);
        const typesParam = ctx.query.get("relation_types");
        const relationTypes = typesParam ? typesParam.split(",") : undefined;

        const result = await traverse(ctx.db, ctx.params.id, {
          maxDepth,
          relationTypes,
        });
        return json({
          entities: result.entities.map(parseEntityRow),
          relations: result.relations.map(parseRelationRow),
        });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Traverse graph",
      description:
        "BFS from an entity up to max_depth hops. Returns reachable entities and relations.",
      tags: ["Traversal"],
      operationId: "traverseGraph",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Start entity ID",
          schema: { type: "string" },
        },
        {
          name: "max_depth",
          in: "query",
          description: "Max hops (default 2, max 5)",
          schema: { type: "integer", maximum: 5, default: 2 },
        },
        {
          name: "relation_types",
          in: "query",
          description: "Comma-separated relation types to follow",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Traversal result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  entities: { type: "array", items: { type: "object" } },
                  relations: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
      },
    },
  );
}
