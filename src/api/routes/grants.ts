import { defineRoute } from "../registry.js";
import { json, parseBodyWithSchema, handleError } from "../middleware.js";
import { audit } from "../../audit.js";
import { assertNamespaceOwnerAccess, assertNamespaceReadAccess } from "../../auth.js";
import { bustIdentityCache, bustIdentityCacheForGroup } from "../../cache-bust.js";
import {
  getNamespaceGrant,
  grantAccess,
  listNamespaceGrants,
  revokeAccess,
} from "../../graph/index.js";
import { parseNamespaceGrantRow } from "../row-parsers.js";
import { zodSchema } from "../schemas.js";
import { namespaceGrantCreateSchema } from "../validators.js";

export function registerGrantRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces/:id/grants",
    async (ctx) => {
      try {
        await assertNamespaceReadAccess(ctx.db, ctx.params.id, ctx.identity);
        return json((await listNamespaceGrants(ctx.db, ctx.params.id)).map(parseNamespaceGrantRow));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List namespace grants",
      tags: ["Namespaces"],
      operationId: "listNamespaceGrants",
      responses: { "200": { description: "Grants" } },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/namespaces/:id/grants",
    async (ctx, request) => {
      try {
        await assertNamespaceOwnerAccess(ctx.db, ctx.params.id, ctx.identity);
        const body = await parseBodyWithSchema(request, namespaceGrantCreateSchema);
        if (body instanceof Response) return body;
        const grantId = await grantAccess(ctx.db, {
          namespace_id: ctx.params.id,
          email: body.email,
          group_id: body.group_id,
          role: body.role,
          granted_by: ctx.email,
          expires_at: body.expires_at,
        });
        if (body.email) await bustIdentityCache(ctx.env.USERS, body.email);
        if (body.group_id) await bustIdentityCacheForGroup(ctx.db, ctx.env.USERS, body.group_id);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "namespace_grant.create",
          email: ctx.email,
          namespace_id: ctx.params.id,
          resource_type: "namespace",
          resource_id: ctx.params.id,
          detail: {
            grant_id: grantId,
            email: body.email,
            group_id: body.group_id,
            role: body.role,
          },
        });
        return json({ id: grantId }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create namespace grant",
      tags: ["Namespaces"],
      operationId: "createNamespaceGrant",
      requestBody: {
        required: true,
        content: { "application/json": { schema: zodSchema(namespaceGrantCreateSchema) } },
      },
      responses: { "201": { description: "Created" } },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/namespaces/:id/grants/:grant_id",
    async (ctx) => {
      try {
        await assertNamespaceOwnerAccess(ctx.db, ctx.params.id, ctx.identity);
        const grant = await getNamespaceGrant(ctx.db, ctx.params.grant_id);
        await revokeAccess(ctx.db, ctx.params.grant_id, ctx.email);
        if (grant?.email) await bustIdentityCache(ctx.env.USERS, grant.email);
        if (grant?.group_id) await bustIdentityCacheForGroup(ctx.db, ctx.env.USERS, grant.group_id);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "namespace_grant.revoke",
          email: ctx.email,
          namespace_id: ctx.params.id,
          resource_type: "namespace",
          resource_id: ctx.params.id,
          detail: {
            grant_id: ctx.params.grant_id,
            email: grant?.email ?? null,
            group_id: grant?.group_id ?? null,
          },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Revoke namespace grant",
      tags: ["Namespaces"],
      operationId: "revokeNamespaceGrant",
      responses: { "200": { description: "Revoked" } },
    },
  );
}
