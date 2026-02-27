/**
 * Public demo endpoint — returns the full demo namespace graph snapshot.
 *
 * Unauthenticated. Queries D1 for the "demo" namespace and returns all
 * entities, relations, and memories in a single response.
 */
import { defineRoute } from "../registry.js";
import { json, jsonError, handleError } from "../middleware.js";
import { searchEntities } from "../../graph/index.js";
import { entitySchema, relationSchema, memorySchema, namespaceSchema } from "../schemas.js";
import { parseEntityRow, parseRelationRow, parseMemoryRow } from "../row-parsers.js";
import type { NamespaceRow, RelationRow, MemoryRow } from "../../types.js";

const DEMO_NAMESPACE_NAME = "demo";

export function registerDemoRoutes(): void {
  defineRoute(
    "GET",
    "/api/demo",
    async (ctx) => {
      try {
        const db = ctx.env.DB;

        // Find the demo namespace by name
        const ns = await db
          .prepare(`SELECT * FROM namespaces WHERE name = ? LIMIT 1`)
          .bind(DEMO_NAMESPACE_NAME)
          .first<NamespaceRow>();

        if (!ns) {
          return jsonError("Demo namespace not seeded. Run the seed script first.", 404);
        }

        // Fetch all demo data in parallel
        const [entities, relations, memories] = await Promise.all([
          searchEntities(db, ns.id, { limit: 200 }),
          db
            .prepare(
              `SELECT * FROM relations WHERE namespace_id = ? ORDER BY weight DESC LIMIT 200`,
            )
            .bind(ns.id)
            .all<RelationRow>(),
          db
            .prepare(
              `SELECT * FROM memories WHERE namespace_id = ? ORDER BY importance DESC LIMIT 200`,
            )
            .bind(ns.id)
            .all<MemoryRow>(),
        ]);

        return json({
          namespace: { id: ns.id, name: ns.name, description: ns.description },
          entities: entities.map(parseEntityRow),
          relations: relations.results.map(parseRelationRow),
          memories: memories.results.map(parseMemoryRow),
          stats: {
            entities: entities.length,
            relations: relations.results.length,
            memories: memories.results.length,
          },
        });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Demo graph snapshot",
      description:
        "Returns the full demo namespace as a read-only graph snapshot: " +
        "all entities, relations, and memories in a single response. " +
        "No authentication required.",
      tags: ["Demo"],
      operationId: "getDemoGraph",
      responses: {
        "200": {
          description: "Full demo namespace graph",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  namespace: namespaceSchema(),
                  entities: { type: "array", items: entitySchema() },
                  relations: { type: "array", items: relationSchema() },
                  memories: { type: "array", items: memorySchema() },
                  stats: {
                    type: "object",
                    properties: {
                      entities: { type: "integer" },
                      relations: { type: "integer" },
                      memories: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        "404": {
          description: "Demo namespace not found",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { type: "string" } },
              },
            },
          },
        },
      },
    },
    { public: true },
  );
}
