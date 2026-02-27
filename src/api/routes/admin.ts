/** Admin REST endpoints + OpenAPI definitions. */
import { defineRoute } from "../registry.js";
import { json, jsonError, handleError } from "../middleware.js";
import { assertNamespaceAccess, isAdmin } from "../../auth.js";
import { listNamespaces, claimUnownedNamespaces, searchEntities } from "../../graph/index.js";
import { searchMemories } from "../../memories.js";
import {
  REINDEX_BATCH_SIZE,
  chunks,
  reindexEntityChunk,
  reindexMemoryChunk,
} from "../../reindex.js";

export function registerAdminRoutes(): void {
  defineRoute(
    "POST",
    "/api/v1/admin/reindex",
    async (ctx, request) => {
      try {
        if (!(await isAdmin(ctx.env.CACHE, ctx.email)))
          return jsonError("Admin access required", 403);
        const body = (await request.json()) as { namespace_id?: string };
        if (!body.namespace_id) return jsonError("namespace_id is required", 400);

        let namespaceIds: string[];
        if (body.namespace_id === "all") {
          const owned = await listNamespaces(ctx.env.DB, ctx.email);
          namespaceIds = owned.map((n) => n.id);
        } else {
          await assertNamespaceAccess(ctx.env.DB, body.namespace_id, ctx.email);
          namespaceIds = [body.namespace_id];
        }

        let entityCount = 0;
        let memoryCount = 0;
        let errorCount = 0;

        for (const nsId of namespaceIds) {
          const entities = await searchEntities(ctx.env.DB, nsId, { limit: 1000 });
          for (const batch of chunks(entities, REINDEX_BATCH_SIZE)) {
            try {
              entityCount += await reindexEntityChunk(ctx.env, batch);
            } catch {
              errorCount += batch.length;
            }
          }

          const memories = await searchMemories(ctx.env.DB, nsId, { limit: 1000 });
          for (const batch of chunks(memories, REINDEX_BATCH_SIZE)) {
            try {
              memoryCount += await reindexMemoryChunk(ctx.env, batch);
            } catch {
              errorCount += batch.length;
            }
          }
        }

        return json({ entities: entityCount, memories: memoryCount, errors: errorCount });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Reindex vectors",
      description: "Re-embed all entities and memories into Vectorize. Use after model changes.",
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
      responses: {
        "200": {
          description: "Reindex results",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  entities: { type: "integer" },
                  memories: { type: "integer" },
                  errors: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/admin/claim-namespaces",
    async (ctx) => {
      try {
        if (!(await isAdmin(ctx.env.CACHE, ctx.email)))
          return jsonError("Admin access required", 403);
        const claimed = await claimUnownedNamespaces(ctx.env.DB, ctx.email);
        return json({ claimed, owner: ctx.email });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Claim namespaces",
      description: "Claim all unowned namespaces for the authenticated user.",
      tags: ["Admin"],
      operationId: "claimNamespaces",
      responses: {
        "200": {
          description: "Claim result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { claimed: { type: "integer" }, owner: { type: "string" } },
              },
            },
          },
        },
      },
    },
  );
}
