import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import {
  createGroup,
  deleteGroup,
  generateSlug,
  getGroup,
  getGroupBySlug,
  getGroupMembership,
  listUserGroups,
  updateGroup,
  validateParentGroup,
} from "../../graph/index.js";
import { audit } from "../../audit.js";
import { bustIdentityCache, bustIdentityCacheForGroupTree } from "../../cache-bust.js";
import { parseGroupRow } from "../row-parsers.js";
import { zodSchema } from "../schemas.js";
import { groupCreateSchema, groupUpdateSchema } from "../validators.js";

async function resolveGroup(db: D1DatabaseSession, id: string) {
  return (await getGroup(db, id)) ?? (await getGroupBySlug(db, id));
}

export function registerGroupRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/groups",
    async (ctx) => {
      try {
        return json((await listUserGroups(ctx.db, ctx.email)).map(parseGroupRow));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List groups",
      tags: ["Groups"],
      operationId: "listGroups",
      responses: { "200": { description: "Groups" } },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/groups",
    async (ctx, request) => {
      try {
        const body = await parseBodyWithSchema(request, groupCreateSchema);
        if (body instanceof Response) return body;
        if (body.parent_group_id) {
          // For new groups we use a dummy ID -- no descendants exist yet
          const check = await validateParentGroup(ctx.db, "new-group", body.parent_group_id);
          if (!check.ok) return jsonError(check.message, check.code);
        }
        const slug = body.slug ?? (await generateSlug(ctx.db, body.name));
        const id = await createGroup(ctx.db, {
          name: body.name,
          slug,
          description: body.description,
          created_by: ctx.email,
          parent_group_id: body.parent_group_id,
        });
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "group.create",
          email: ctx.email,
          resource_type: "group",
          resource_id: id,
          detail: { name: body.name, slug },
        });
        await bustIdentityCache(ctx.env.USERS, ctx.email);
        return json({ id, slug, name: body.name }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create group",
      tags: ["Groups"],
      operationId: "createGroup",
      requestBody: {
        required: true,
        content: { "application/json": { schema: zodSchema(groupCreateSchema) } },
      },
      responses: { "201": { description: "Created" } },
    },
  );

  defineRoute(
    "GET",
    "/api/v1/groups/:id",
    async (ctx) => {
      try {
        const group = await resolveGroup(ctx.db as D1DatabaseSession, ctx.params.id);
        if (!group || group.deleted_at) return jsonError("Group not found", 404);
        const membership = await getGroupMembership(ctx.db, group.id, ctx.email);
        if (!membership || membership.status !== "active") return jsonError("Access denied", 403);
        return json(parseGroupRow(group));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get group",
      tags: ["Groups"],
      operationId: "getGroup",
      responses: { "200": { description: "Group" } },
    },
  );

  defineRoute(
    "PATCH",
    "/api/v1/groups/:id",
    async (ctx, request) => {
      try {
        const group = await resolveGroup(ctx.db as D1DatabaseSession, ctx.params.id);
        if (!group || group.deleted_at) return jsonError("Group not found", 404);
        const caller = await getGroupMembership(ctx.db, group.id, ctx.email);
        if (
          !caller ||
          caller.status !== "active" ||
          (caller.role !== "owner" && caller.role !== "admin")
        ) {
          return jsonError("Access denied", 403);
        }
        const body = await parseBodyWithSchema(request, groupUpdateSchema);
        if (body instanceof Response) return body;
        if (body.parent_group_id !== undefined) {
          const check = await validateParentGroup(ctx.db, group.id, body.parent_group_id ?? null);
          if (!check.ok) return jsonError(check.message, check.code);
        }
        await updateGroup(ctx.db, group.id, body);
        if (body.parent_group_id !== undefined) {
          await bustIdentityCacheForGroupTree(ctx.db, ctx.env.USERS, group.id);
        }
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "group.update",
          email: ctx.email,
          resource_type: "group",
          resource_id: group.id,
          detail: body,
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Update group",
      tags: ["Groups"],
      operationId: "updateGroup",
      requestBody: { content: { "application/json": { schema: zodSchema(groupUpdateSchema) } } },
      responses: { "200": { description: "Updated" } },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/groups/:id",
    async (ctx) => {
      try {
        const group = await resolveGroup(ctx.db as D1DatabaseSession, ctx.params.id);
        if (!group || group.deleted_at) return jsonError("Group not found", 404);
        const caller = await getGroupMembership(ctx.db, group.id, ctx.email);
        if (!caller || caller.status !== "active" || caller.role !== "owner") {
          return jsonError("Owner access required", 403);
        }
        await deleteGroup(ctx.db, group.id);
        await bustIdentityCacheForGroupTree(ctx.db, ctx.env.USERS, group.id);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "group.delete",
          email: ctx.email,
          resource_type: "group",
          resource_id: group.id,
          detail: { name: group.name },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Delete group",
      tags: ["Groups"],
      operationId: "deleteGroup",
      responses: { "200": { description: "Deleted" } },
    },
  );
}
