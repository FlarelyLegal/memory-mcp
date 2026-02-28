import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  groupDescriptionField,
  groupNameField,
  groupPrivacy,
  groupRole,
  memberStatus,
  slugField,
} from "../tool-schemas.js";
import type { Env, StateHandle } from "../types.js";
import { session } from "../db.js";
import { bustIdentityCache, bustIdentityCacheForGroup } from "../identity.js";
import * as graph from "../graph/index.js";
import { ADMIN_ROLES, requireMembership, resolveGroup } from "./group-helpers.js";
import { audit } from "../audit.js";
import { txt, err, ok, cap, confirm, trackTools } from "../response-helpers.js";

export function registerGroupTools(
  server: McpServer,
  env: Env,
  email: string,
  _agent: StateHandle,
) {
  const tracked = trackTools(env, email);
  server.tool(
    "manage_group",
    "Create, view, update, delete groups and manage group members.",
    {
      action: z.enum([
        "create",
        "get",
        "list",
        "update",
        "delete",
        "add_member",
        "remove_member",
        "update_member_role",
        "list_members",
      ]),
      group_id: z.string().uuid().optional(),
      slug: slugField.optional(),
      name: groupNameField.optional(),
      description: groupDescriptionField.optional(),
      privacy: groupPrivacy.optional(),
      member_email: z.string().email().max(320).optional(),
      role: groupRole.optional(),
      status: memberStatus.optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    {
      title: "Manage Group",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    tracked(
      "manage_group",
      async ({
        action,
        group_id,
        slug,
        name,
        description,
        privacy,
        member_email,
        role,
        status,
        limit,
        offset,
      }) => {
        const db = session(
          env.DB,
          action === "list" || action === "get" ? "first-unconstrained" : "first-primary",
        );

        if (action === "create") {
          if (!name) return err("name required");
          const nextSlug = slug ?? (await graph.generateSlug(db, name));
          const id = await graph.createGroup(db, {
            name,
            slug: nextSlug,
            description,
            created_by: email,
          });
          await graph.addGroupMember(db, {
            group_id: id,
            email,
            role: "owner",
            invited_by: email,
            status: "active",
          });
          await graph.incrementMemberCount(db, id, 1);
          await bustIdentityCache(env.USERS, email);
          await audit(db, env.STORAGE, {
            action: "group.create",
            email,
            resource_type: "group",
            resource_id: id,
            detail: { name, slug: nextSlug },
          });
          return txt({ id, name, slug: nextSlug });
        }

        if (action === "list") {
          const groups = await graph.listUserGroups(db, email);
          return txt(
            groups.map((g) => ({ id: g.id, name: g.name, slug: g.slug, role: undefined })),
          );
        }

        const group = await resolveGroup(db, group_id, slug);
        if (!group) return err("group not found");

        if (action === "get") {
          const membership = await requireMembership(db, group.id, email);
          if (!membership) return err("access denied");
          return txt(group);
        }

        if (action === "list_members") {
          const membership = await requireMembership(db, group.id, email);
          if (!membership) return err("access denied");
          const rows = await graph.listGroupMembers(db, group.id, {
            limit: cap(limit, 200, 100),
            offset: offset ?? 0,
          });
          return txt(rows);
        }

        if (action === "update") {
          const membership = await requireMembership(db, group.id, email, ADMIN_ROLES);
          if (!membership) return err("owner/admin access required");
          if (!name && !description && !privacy && !slug) {
            return err("at least one of name, description, privacy, or slug required");
          }
          await graph.updateGroup(db, group.id, { name, description, privacy, slug });
          await audit(db, env.STORAGE, {
            action: "group.update",
            email,
            resource_type: "group",
            resource_id: group.id,
            detail: { name, description, privacy, slug },
          });
          return ok("Group updated");
        }

        if (action === "delete") {
          const membership = await requireMembership(db, group.id, email, ["owner"]);
          if (!membership) return err("owner access required");
          if (!(await confirm(server, `Delete group "${group.name}"?`))) return err("Cancelled");
          await graph.deleteGroup(db, group.id);
          await bustIdentityCacheForGroup(db, env.USERS, group.id);
          await audit(db, env.STORAGE, {
            action: "group.delete",
            email,
            resource_type: "group",
            resource_id: group.id,
            detail: { name: group.name },
          });
          return ok("Group deleted");
        }

        if (action === "add_member") {
          if (!member_email) return err("member_email required");
          const membership = await requireMembership(db, group.id, email, ADMIN_ROLES);
          if (!membership) return err("owner/admin access required");
          const existing = await graph.getGroupMembership(db, group.id, member_email);
          if (existing && existing.status === "active") return err("member already exists");
          await graph.addGroupMember(db, {
            group_id: group.id,
            email: member_email,
            role: role ?? "member",
            invited_by: email,
            status: status ?? "active",
          });
          await graph.incrementMemberCount(db, group.id, 1);
          await bustIdentityCache(env.USERS, member_email);
          await audit(db, env.STORAGE, {
            action: "group_member.add",
            email,
            resource_type: "group_member",
            resource_id: group.id,
            detail: { group_id: group.id, member_email, role: role ?? "member" },
          });
          return ok("Member added");
        }

        if (action === "remove_member") {
          if (!member_email) return err("member_email required");
          const membership = await requireMembership(db, group.id, email, ADMIN_ROLES);
          if (!membership) return err("owner/admin access required");
          const member = await graph.getGroupMembership(db, group.id, member_email);
          if (!member) return err("member not found");
          if (member.role === "owner" && (await graph.countGroupOwners(db, group.id)) <= 1) {
            return err("cannot remove last owner");
          }
          await graph.removeGroupMember(db, group.id, member_email);
          await graph.incrementMemberCount(db, group.id, -1);
          await bustIdentityCache(env.USERS, member_email);
          await audit(db, env.STORAGE, {
            action: "group_member.remove",
            email,
            resource_type: "group_member",
            resource_id: group.id,
            detail: { group_id: group.id, member_email },
          });
          return ok("Member removed");
        }

        if (!member_email || !role) return err("member_email and role required");
        const membership = await requireMembership(db, group.id, email, ADMIN_ROLES);
        if (!membership) return err("owner/admin access required");
        const member = await graph.getGroupMembership(db, group.id, member_email);
        if (!member) return err("member not found");
        if (
          member.role === "owner" &&
          role !== "owner" &&
          (await graph.countGroupOwners(db, group.id)) <= 1
        ) {
          return err("cannot demote last owner");
        }
        await graph.updateGroupMemberRole(db, group.id, member_email, role);
        await bustIdentityCache(env.USERS, member_email);
        await audit(db, env.STORAGE, {
          action: "group_member.update_role",
          email,
          resource_type: "group_member",
          resource_id: group.id,
          detail: { group_id: group.id, member_email, role },
        });
        return ok("Member role updated");
      },
    ),
  );
}
