/** Namespace single-resource REST endpoints (GET, PATCH, DELETE by ID). */
import { z } from "zod";
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import {
  updateNamespace,
  updateNamespaceVisibility,
  collectNamespaceVectorIds,
  deleteNamespace,
} from "../../graph/index.js";
import { deleteVectorBatch } from "../../vectorize.js";
import { assertNamespaceReadAccess, assertNamespaceWriteAccess } from "../../auth.js";
import { nameField, descriptionField, visibility } from "../../tool-schemas.js";
import { namespaceSchema, okSchema, zodSchema } from "../schemas.js";
import { parseNamespaceRow } from "../row-parsers.js";
import { audit } from "../../audit.js";
import { bustIdentityCacheForNamespace } from "../../cache-bust.js";
import type { NamespaceVisibility } from "../../types.js";
import { wantsHtml } from "../html/negotiate.js";
import { renderNamespaceDetail } from "../html/namespace-detail.js";
import { fetchNamespaceDetail } from "../html/queries.js";
import { toISO } from "../../utils.js";

const idParam = {
  name: "id",
  in: "path" as const,
  required: true,
  description: "Namespace ID",
  schema: { type: "string" as const, format: "uuid" },
};

export function registerNamespaceCrudRoutes(): void {
  defineRoute(
    "GET",
    "/api/v1/namespaces/:id",
    async (ctx, request) => {
      try {
        const ns = await assertNamespaceReadAccess(ctx.db, ctx.params.id, ctx.identity);

        if (wantsHtml(request)) {
          const detail = await fetchNamespaceDetail(ctx.db, ctx.params.id);
          return renderNamespaceDetail({
            namespace: {
              id: ns.id,
              name: ns.name,
              owner: ns.owner,
              visibility: ns.visibility,
              description: ns.description,
              created_at: toISO(ns.created_at),
              updated_at: toISO(ns.updated_at),
            },
            ...detail,
          });
        }

        return json(parseNamespaceRow(ns));
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get namespace",
      description: "Get a single namespace by ID. Owner or public visibility required.",
      tags: ["Namespaces"],
      operationId: "getNamespace",
      parameters: [idParam],
      responses: {
        "200": {
          description: "Namespace details",
          content: { "application/json": { schema: namespaceSchema() } },
        },
      },
    },
  );

  defineRoute(
    "PATCH",
    "/api/v1/namespaces/:id",
    async (ctx, request) => {
      try {
        await assertNamespaceWriteAccess(ctx.db, ctx.params.id, ctx.identity);
        const body = await parseBody<{
          name?: string;
          description?: string;
          visibility?: string;
        }>(request);
        if (body instanceof Response) return body;
        if (!body.name && body.description === undefined && !body.visibility)
          return jsonError("At least one of name, description, or visibility required", 400);
        if (body.visibility) {
          if (!ctx.identity.isAdmin)
            return jsonError("Admin access required for visibility changes", 403);
          if (body.visibility !== "private" && body.visibility !== "public")
            return jsonError("visibility must be 'private' or 'public'", 400);
          await updateNamespaceVisibility(
            ctx.db,
            ctx.params.id,
            body.visibility as NamespaceVisibility,
          );
        }
        if (body.name || body.description !== undefined) {
          await updateNamespace(ctx.db, ctx.params.id, {
            name: body.name,
            description: body.description,
          });
        }
        await audit(ctx.db, ctx.env.STORAGE, {
          action: body.visibility ? "namespace.set_visibility" : "namespace.update",
          email: ctx.email,
          namespace_id: ctx.params.id,
          resource_type: "namespace",
          resource_id: ctx.params.id,
          detail: { name: body.name, description: body.description, visibility: body.visibility },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Update namespace",
      description:
        "Update namespace name, description, or visibility. Owner or admin required. Visibility changes require admin.",
      tags: ["Namespaces"],
      operationId: "updateNamespace",
      parameters: [idParam],
      requestBody: {
        content: {
          "application/json": {
            schema: zodSchema(
              z.object({
                name: nameField.optional(),
                description: descriptionField.optional(),
                visibility: visibility.optional(),
              }),
            ),
          },
        },
      },
      responses: {
        "200": {
          description: "Updated",
          content: { "application/json": { schema: okSchema() } },
        },
      },
    },
  );

  defineRoute(
    "DELETE",
    "/api/v1/namespaces/:id",
    async (ctx) => {
      try {
        const ns = await assertNamespaceWriteAccess(ctx.db, ctx.params.id, ctx.identity);
        const vectorIds = await collectNamespaceVectorIds(ctx.db, ctx.params.id);
        await bustIdentityCacheForNamespace(ctx.db, ctx.env.USERS, ctx.params.id, [
          ctx.email,
          ns.owner ?? "",
        ]);
        await deleteNamespace(ctx.db, ctx.params.id);
        await deleteVectorBatch(ctx.env, vectorIds);
        await audit(ctx.db, ctx.env.STORAGE, {
          action: "namespace.delete",
          email: ctx.email,
          namespace_id: ctx.params.id,
          resource_type: "namespace",
          resource_id: ctx.params.id,
          detail: { name: ns.name, vectors_deleted: vectorIds.length },
        });
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Delete namespace",
      description:
        "Delete a namespace and all its contents. Vectors are removed from Vectorize. Owner or admin required.",
      tags: ["Namespaces"],
      operationId: "deleteNamespace",
      parameters: [idParam],
      responses: {
        "200": {
          description: "Deleted",
          content: { "application/json": { schema: okSchema() } },
        },
      },
    },
  );
}
