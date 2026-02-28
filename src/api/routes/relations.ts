/** Relation REST endpoints + OpenAPI definitions. */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import {
  createRelation,
  getEntity,
  getRelationsFrom,
  getRelationsTo,
  deleteRelation,
} from "../../graph/index.js";
import {
  assertNamespaceWriteAccess,
  assertEntityAccess,
  assertEntityReadAccess,
  assertRelationAccess,
  isAdmin,
} from "../../auth.js";
import {
  nsPathParam,
  idPathParam,
  limitQueryParam,
  queryLimit,
  relationSchema,
  okSchema,
  zodSchema,
} from "../schemas.js";
import { relationCreateSchema } from "../validators.js";
import { parseRelationRow } from "../row-parsers.js";
import { audit } from "../../audit.js";

export function registerRelationRoutes(): void {
  defineRoute(
    "POST",
    "/api/v1/namespaces/:namespace_id/relations",
    async (ctx, request) => {
      try {
        const admin = await isAdmin(ctx.env.FLAGS, ctx.email);
        await assertNamespaceWriteAccess(ctx.db, ctx.params.namespace_id, ctx.email, admin);
        const body = await parseBody(request);
        if (body instanceof Response) return body;
        const parsed = relationCreateSchema.safeParse(body);
        if (!parsed.success) {
          return jsonError(parsed.error.issues[0]?.message ?? "Invalid request body", 400);
        }
        const payload = parsed.data;

        await assertEntityAccess(ctx.db, payload.source_id, ctx.email, admin);
        await assertEntityAccess(ctx.db, payload.target_id, ctx.email, admin);

        const [source, target] = await Promise.all([
          getEntity(ctx.db, payload.source_id),
          getEntity(ctx.db, payload.target_id),
        ]);
        if (!source || !target) {
          return jsonError("source_id and target_id must exist", 400);
        }
        if (
          source.namespace_id !== ctx.params.namespace_id ||
          target.namespace_id !== ctx.params.namespace_id
        ) {
          return jsonError("source_id and target_id must belong to namespace_id", 400);
        }

        const id = await createRelation(ctx.db, {
          namespace_id: ctx.params.namespace_id,
          source_id: payload.source_id,
          target_id: payload.target_id,
          relation_type: payload.relation_type,
          weight: payload.weight,
          metadata: payload.metadata,
        });
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "relation.create",
          email: ctx.email,
          namespace_id: ctx.params.namespace_id,
          resource_type: "relation",
          resource_id: id,
          detail: {
            source_id: payload.source_id,
            target_id: payload.target_id,
            relation_type: payload.relation_type,
          },
        });
        return json(
          {
            id,
            source_id: payload.source_id,
            target_id: payload.target_id,
            relation_type: payload.relation_type,
          },
          201,
        );
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create relation",
      description: "Create a directed relation between two entities in the same namespace.",
      tags: ["Relations"],
      operationId: "createRelation",
      parameters: [nsPathParam()],
      requestBody: {
        required: true,
        content: { "application/json": { schema: zodSchema(relationCreateSchema) } },
      },
      responses: {
        "201": {
          description: "Relation created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  source_id: { type: "string" },
                  target_id: { type: "string" },
                  relation_type: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  );

  defineRoute(
    "GET",
    "/api/v1/entities/:id/relations",
    async (ctx) => {
      try {
        await assertEntityReadAccess(ctx.db, ctx.params.id, ctx.email);
        const direction = ctx.query.get("direction") ?? "both";
        const relationType = ctx.query.get("relation_type") ?? undefined;
        const limit = queryLimit(ctx.query, 50);
        const opts = { relation_type: relationType, limit };

        const results: unknown[] = [];
        if (direction === "from" || direction === "both") {
          results.push(...(await getRelationsFrom(ctx.db, ctx.params.id, opts)));
        }
        if (direction === "to" || direction === "both") {
          results.push(...(await getRelationsTo(ctx.db, ctx.params.id, opts)));
        }
        return json((results as import("../../types.js").RelationRow[]).map(parseRelationRow));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get relations",
      description: "Query relations from/to an entity.",
      tags: ["Relations"],
      operationId: "getRelations",
      parameters: [
        idPathParam("Entity ID"),
        {
          name: "direction",
          in: "query",
          schema: { type: "string", enum: ["from", "to", "both"], default: "both" },
        },
        { name: "relation_type", in: "query", schema: { type: "string" } },
        limitQueryParam(50),
      ],
      responses: {
        "200": {
          description: "Array of relations",
          content: {
            "application/json": { schema: { type: "array", items: relationSchema() } },
          },
        },
      },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/relations/:id",
    async (ctx) => {
      try {
        const admin = await isAdmin(ctx.env.FLAGS, ctx.email);
        await assertRelationAccess(ctx.db, ctx.params.id, ctx.email, admin);
        await deleteRelation(ctx.db, ctx.params.id);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "relation.delete",
          email: ctx.email,
          resource_type: "relation",
          resource_id: ctx.params.id,
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Delete relation",
      tags: ["Relations"],
      operationId: "deleteRelation",
      parameters: [idPathParam("Relation ID")],
      responses: {
        "200": {
          description: "Deleted",
          content: {
            "application/json": { schema: okSchema() },
          },
        },
      },
    },
  );
}
