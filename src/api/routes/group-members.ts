import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import {
  addGroupMember,
  countGroupOwners,
  getGroup,
  getGroupBySlug,
  getGroupMembership,
  incrementMemberCount,
  listGroupMembers,
  removeGroupMember,
  updateGroupMemberRole,
} from "../../graph/index.js";
import { audit } from "../../audit.js";
import { bustIdentityCache } from "../../cache-bust.js";
import { parseGroupMemberRow } from "../row-parsers.js";
import { zodSchema } from "../schemas.js";
import { groupMemberAddSchema, groupMemberRoleSchema } from "../validators.js";

async function resolveGroup(db: D1DatabaseSession, id: string) {
  return (await getGroup(db, id)) ?? (await getGroupBySlug(db, id));
}

function canManage(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function registerGroupMemberRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/groups/:id/members",
    async (ctx) => {
      try {
        const group = await resolveGroup(ctx.db as D1DatabaseSession, ctx.params.id);
        if (!group || group.deleted_at) return jsonError("Group not found", 404);
        const caller = await getGroupMembership(ctx.db, group.id, ctx.email);
        if (!caller || caller.status !== "active") return jsonError("Access denied", 403);
        return json(
          (await listGroupMembers(ctx.db, group.id, { limit: 200, offset: 0 })).map(
            parseGroupMemberRow,
          ),
        );
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List group members",
      tags: ["Groups"],
      operationId: "listGroupMembers",
      responses: { "200": { description: "Members" } },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/groups/:id/members",
    async (ctx, request) => {
      try {
        const group = await resolveGroup(ctx.db as D1DatabaseSession, ctx.params.id);
        if (!group || group.deleted_at) return jsonError("Group not found", 404);
        const caller = await getGroupMembership(ctx.db, group.id, ctx.email);
        if (!caller || caller.status !== "active" || !canManage(caller.role))
          return jsonError("Access denied", 403);
        const body = await parseBodyWithSchema(request, groupMemberAddSchema);
        if (body instanceof Response) return body;
        await addGroupMember(ctx.db, {
          group_id: group.id,
          email: body.email,
          role: body.role ?? "member",
          status: body.status ?? "active",
          invited_by: ctx.email,
        });
        await incrementMemberCount(ctx.db, group.id, 1);
        await bustIdentityCache(ctx.env.USERS, body.email);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "group_member.add",
          email: ctx.email,
          resource_type: "group_member",
          resource_id: group.id,
          detail: { member_email: body.email, role: body.role ?? "member" },
        });
        return json({ ok: true }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Add group member",
      tags: ["Groups"],
      operationId: "addGroupMember",
      requestBody: {
        required: true,
        content: { "application/json": { schema: zodSchema(groupMemberAddSchema) } },
      },
      responses: { "201": { description: "Added" } },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/groups/:id/members/:email",
    async (ctx) => {
      try {
        const group = await resolveGroup(ctx.db as D1DatabaseSession, ctx.params.id);
        if (!group || group.deleted_at) return jsonError("Group not found", 404);
        const caller = await getGroupMembership(ctx.db, group.id, ctx.email);
        if (!caller || caller.status !== "active" || !canManage(caller.role))
          return jsonError("Access denied", 403);
        const target = await getGroupMembership(ctx.db, group.id, ctx.params.email);
        if (!target) return jsonError("Member not found", 404);
        if (target.role === "owner" && (await countGroupOwners(ctx.db, group.id)) <= 1) {
          return jsonError("Cannot remove last owner", 400);
        }
        await removeGroupMember(ctx.db, group.id, ctx.params.email);
        await incrementMemberCount(ctx.db, group.id, -1);
        await bustIdentityCache(ctx.env.USERS, ctx.params.email);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "group_member.remove",
          email: ctx.email,
          resource_type: "group_member",
          resource_id: group.id,
          detail: { member_email: ctx.params.email },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Remove group member",
      tags: ["Groups"],
      operationId: "removeGroupMember",
      responses: { "200": { description: "Removed" } },
    },
  );

  defineRoute(
    "PATCH",
    "/api/v1/groups/:id/members/:email",
    async (ctx, request) => {
      try {
        const group = await resolveGroup(ctx.db as D1DatabaseSession, ctx.params.id);
        if (!group || group.deleted_at) return jsonError("Group not found", 404);
        const caller = await getGroupMembership(ctx.db, group.id, ctx.email);
        if (!caller || caller.status !== "active" || !canManage(caller.role))
          return jsonError("Access denied", 403);
        const body = await parseBodyWithSchema(request, groupMemberRoleSchema);
        if (body instanceof Response) return body;
        const target = await getGroupMembership(ctx.db, group.id, ctx.params.email);
        if (!target) return jsonError("Member not found", 404);
        if (
          target.role === "owner" &&
          body.role !== "owner" &&
          (await countGroupOwners(ctx.db, group.id)) <= 1
        ) {
          return jsonError("Cannot demote last owner", 400);
        }
        await updateGroupMemberRole(ctx.db, group.id, ctx.params.email, body.role);
        await bustIdentityCache(ctx.env.USERS, ctx.params.email);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "group_member.update_role",
          email: ctx.email,
          resource_type: "group_member",
          resource_id: group.id,
          detail: { member_email: ctx.params.email, role: body.role },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Update group member role",
      tags: ["Groups"],
      operationId: "updateGroupMemberRole",
      requestBody: {
        required: true,
        content: { "application/json": { schema: zodSchema(groupMemberRoleSchema) } },
      },
      responses: { "200": { description: "Updated" } },
    },
  );
}
