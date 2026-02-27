/** Admin REST endpoints: claim-namespaces, stats + OpenAPI definitions. */
import { defineRoute } from "../registry.js";
import { json, jsonError, handleError } from "../middleware.js";
import { assertNamespaceAccess, isAdmin } from "../../auth.js";
import { claimUnownedNamespaces } from "../../graph/index.js";
import { getNamespaceStats } from "../../consolidation.js";
import { audit } from "../../audit.js";

export function registerAdminRoutes(): void {
  // --- Namespace stats ---
  defineRoute(
    "GET",
    "/api/v1/admin/stats/:namespace_id",
    async (ctx) => {
      try {
        await assertNamespaceAccess(ctx.db, ctx.params.namespace_id, ctx.email);
        const stats = await getNamespaceStats(ctx.db, ctx.params.namespace_id);
        return json(stats);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Namespace stats",
      description:
        "Get aggregate statistics: entity, memory, relation, conversation, and message counts, average importance, and archived count.",
      tags: ["Admin"],
      operationId: "getNamespaceStats",
      parameters: [
        {
          name: "namespace_id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": {
          description: "Namespace statistics",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  namespace_id: { type: "string" },
                  entity_count: { type: "integer" },
                  memory_count: { type: "integer" },
                  relation_count: { type: "integer" },
                  conversation_count: { type: "integer" },
                  message_count: { type: "integer" },
                  avg_importance: { type: "number" },
                  archived_count: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  );

  // --- Claim namespaces ---
  defineRoute(
    "POST",
    "/api/v1/admin/claim-namespaces",
    async (ctx) => {
      try {
        if (!(await isAdmin(ctx.env.CACHE, ctx.email)))
          return jsonError("Admin access required", 403);
        const claimed = await claimUnownedNamespaces(ctx.db, ctx.email);
        if (claimed > 0) {
          await audit(ctx.db, ctx.env.STORAGE, {
            action: "namespace.claim",
            email: ctx.email,
            resource_type: "namespace",
            detail: { claimed },
          });
        }
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
