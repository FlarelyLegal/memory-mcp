/**
 * Service token collection endpoints: bind (POST) and list (GET).
 *
 * Bindings are stored in KV as: key "st:<common_name>" → {email, label, created_at}.
 * The common_name equals the CF-Access-Client-Id and survives token rotation.
 *
 * Single-token operations (get, update, delete) live in token-crud.ts.
 */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBody, handleError } from "../middleware.js";
import { ST_PREFIX } from "../service-tokens.js";
import type { ServiceTokenMapping } from "../service-tokens.js";
import { tokenSchema } from "../schemas.js";

export function registerTokenRoutes(): void {
  // --- POST /api/v1/admin/service-tokens (bind) ---

  defineRoute(
    "POST",
    "/api/v1/admin/service-tokens",
    async (ctx, request) => {
      try {
        const body = await parseBody<{ common_name?: string; label?: string }>(request);
        if (body instanceof Response) return body;
        if (!body.common_name) return jsonError("common_name is required", 400);

        const key = `${ST_PREFIX}${body.common_name}`;
        const existing = await ctx.env.CACHE.get<ServiceTokenMapping>(key, "json");
        if (existing) {
          return jsonError(`Service token already bound to ${existing.email}`, 409);
        }

        const mapping: ServiceTokenMapping = {
          email: ctx.email,
          label: body.label ?? body.common_name,
          created_at: Math.floor(Date.now() / 1000),
        };
        await ctx.env.CACHE.put(key, JSON.stringify(mapping));
        return json({ common_name: body.common_name, ...mapping }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Bind service token",
      description:
        "Bind a Cloudflare Access service token to the authenticated user's email. " +
        "The common_name is the CF-Access-Client-Id shown when you create the service token.",
      tags: ["Admin"],
      operationId: "bindServiceToken",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["common_name"],
              properties: {
                common_name: {
                  type: "string",
                  description: "CF-Access-Client-Id (e.g. abc123.access)",
                },
                label: { type: "string", description: "Human-readable label" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Service token bound",
          content: { "application/json": { schema: tokenSchema() } },
        },
        "409": {
          description: "Service token already bound",
          content: {
            "application/json": {
              schema: { type: "object", properties: { error: { type: "string" } } },
            },
          },
        },
      },
    },
  );

  // --- GET /api/v1/admin/service-tokens (list) ---

  defineRoute(
    "GET",
    "/api/v1/admin/service-tokens",
    async (ctx) => {
      try {
        const tokens: Array<{ common_name: string } & ServiceTokenMapping> = [];
        let cursor: string | undefined;
        do {
          const batch = await ctx.env.CACHE.list({ prefix: ST_PREFIX, cursor });
          for (const key of batch.keys) {
            const mapping = await ctx.env.CACHE.get<ServiceTokenMapping>(key.name, "json");
            if (mapping && mapping.email === ctx.email) {
              tokens.push({ common_name: key.name.slice(ST_PREFIX.length), ...mapping });
            }
          }
          cursor = batch.list_complete ? undefined : (batch.cursor as string);
        } while (cursor);
        return json(tokens);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "List service token bindings",
      description: "List all service tokens bound to the authenticated user's email.",
      tags: ["Admin"],
      operationId: "listServiceTokens",
      responses: {
        "200": {
          description: "List of bound service tokens",
          content: {
            "application/json": {
              schema: { type: "array", items: tokenSchema() },
            },
          },
        },
      },
    },
  );
}
