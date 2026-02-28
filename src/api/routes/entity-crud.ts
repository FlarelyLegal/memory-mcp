/** Entity get/update/delete REST endpoints. */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import { getEntity, updateEntity, deleteEntity } from "../../graph/index.js";
import { assertEntityAccess, assertEntityReadAccess, isAdmin } from "../../auth.js";
import { upsertEntityVector, deleteVector } from "../../vectorize.js";
import { idPathParam, entitySchema, okSchema, zodSchema } from "../schemas.js";
import { parseEntityRow } from "../row-parsers.js";
import { entityUpdateSchema } from "../validators.js";
import { audit } from "../../audit.js";

export function registerEntityCrudRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/entities/:id",
    async (ctx) => {
      try {
        await assertEntityReadAccess(ctx.db, ctx.params.id, ctx.email);
        const entity = await getEntity(ctx.db, ctx.params.id);
        if (!entity) return jsonError("Entity not found", 404);
        return json(parseEntityRow(entity));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get entity",
      tags: ["Entities"],
      operationId: "getEntity",
      parameters: [idPathParam("Entity ID")],
      responses: {
        "200": {
          description: "Entity",
          content: {
            "application/json": { schema: entitySchema() },
          },
        },
      },
    },
  );

  defineRoute(
    "PUT",
    "/api/v1/entities/:id",
    async (ctx, request) => {
      try {
        const admin = await isAdmin(ctx.env.FLAGS, ctx.email);
        await assertEntityAccess(ctx.db, ctx.params.id, ctx.email, admin);
        const body = await parseBodyWithSchema(request, entityUpdateSchema);
        if (body instanceof Response) return body;
        await updateEntity(ctx.db, ctx.params.id, body);
        if (body.name || body.type || body.summary !== undefined) {
          const updated = await getEntity(ctx.db, ctx.params.id);
          if (updated) {
            await upsertEntityVector(ctx.env, {
              entity_id: ctx.params.id,
              namespace_id: updated.namespace_id,
              name: updated.name,
              type: updated.type,
              summary: updated.summary,
            });
          }
        }
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "entity.update",
          email: ctx.email,
          resource_type: "entity",
          resource_id: ctx.params.id,
          detail: { name: body.name, type: body.type, summary: !!body.summary },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Update entity",
      tags: ["Entities"],
      operationId: "updateEntity",
      parameters: [idPathParam("Entity ID")],
      requestBody: {
        content: { "application/json": { schema: zodSchema(entityUpdateSchema) } },
      },
      responses: {
        "200": { description: "Updated", content: { "application/json": { schema: okSchema() } } },
      },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/entities/:id",
    async (ctx) => {
      try {
        const admin = await isAdmin(ctx.env.FLAGS, ctx.email);
        await assertEntityAccess(ctx.db, ctx.params.id, ctx.email, admin);
        await deleteEntity(ctx.db, ctx.params.id);
        await deleteVector(ctx.env, "entity", ctx.params.id);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "entity.delete",
          email: ctx.email,
          resource_type: "entity",
          resource_id: ctx.params.id,
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Delete entity",
      tags: ["Entities"],
      operationId: "deleteEntity",
      parameters: [idPathParam("Entity ID")],
      responses: {
        "200": { description: "Deleted", content: { "application/json": { schema: okSchema() } } },
      },
    },
  );
}
