/**
 * Single service-token operations: get, update (label), and revoke.
 *
 * Collection-level endpoints (bind, list) live in tokens.ts.
 */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import { ST_PREFIX } from "../service-tokens.js";
import type { ServiceTokenMapping } from "../service-tokens.js";
import { tokenSchema } from "../schemas.js";
import { serviceTokenLabelSchema } from "../validators.js";

const cnParam = {
  name: "common_name",
  in: "path" as const,
  required: true,
  description: "CF-Access-Client-Id",
  schema: { type: "string" as const },
};

export function registerTokenCrudRoutes(): void {
  // --- GET /api/v1/admin/service-tokens/:common_name ---

  defineRoute(
    "GET",
    "/api/v1/admin/service-tokens/:common_name",
    async (ctx) => {
      try {
        const key = `${ST_PREFIX}${ctx.params.common_name}`;
        const mapping = await ctx.env.CACHE.get<ServiceTokenMapping>(key, "json");
        if (!mapping) return jsonError("Service token not found", 404);
        if (mapping.email !== ctx.email) return jsonError("Access denied", 403);
        return json({ common_name: ctx.params.common_name, ...mapping });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Get service token binding",
      tags: ["Admin"],
      operationId: "getServiceToken",
      parameters: [cnParam],
      responses: {
        "200": {
          description: "Service token binding",
          content: { "application/json": { schema: tokenSchema() } },
        },
      },
    },
  );

  // --- PATCH /api/v1/admin/service-tokens/:common_name ---

  defineRoute(
    "PATCH",
    "/api/v1/admin/service-tokens/:common_name",
    async (ctx, request) => {
      try {
        const key = `${ST_PREFIX}${ctx.params.common_name}`;
        const mapping = await ctx.env.CACHE.get<ServiceTokenMapping>(key, "json");
        if (!mapping) return jsonError("Service token not found", 404);
        if (mapping.email !== ctx.email) return jsonError("Access denied", 403);

        const body = await parseBodyWithSchema(request, serviceTokenLabelSchema);
        if (body instanceof Response) return body;

        mapping.label = body.label;
        await ctx.env.CACHE.put(key, JSON.stringify(mapping));
        return json({ common_name: ctx.params.common_name, ...mapping });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Update service token binding",
      description: "Update the label on a service token binding.",
      tags: ["Admin"],
      operationId: "updateServiceToken",
      parameters: [cnParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["label"],
              properties: {
                label: { type: "string", description: "New human-readable label" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Updated service token binding",
          content: { "application/json": { schema: tokenSchema() } },
        },
      },
    },
  );

  // --- DELETE /api/v1/admin/service-tokens/:common_name ---

  defineRoute(
    "DELETE",
    "/api/v1/admin/service-tokens/:common_name",
    async (ctx) => {
      try {
        const key = `${ST_PREFIX}${ctx.params.common_name}`;
        const mapping = await ctx.env.CACHE.get<ServiceTokenMapping>(key, "json");
        if (!mapping) return jsonError("Service token not found", 404);
        if (mapping.email !== ctx.email) return jsonError("Access denied", 403);
        await ctx.env.CACHE.delete(key);
        return json({ ok: true });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Revoke service token binding",
      description:
        "Remove the email binding for a service token. The token can no longer access the API.",
      tags: ["Admin"],
      operationId: "revokeServiceToken",
      parameters: [cnParam],
      responses: {
        "200": {
          description: "Revoked",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { ok: { type: "boolean" } },
              },
            },
          },
        },
      },
    },
  );
}
