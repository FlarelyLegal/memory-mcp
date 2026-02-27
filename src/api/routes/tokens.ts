/** Service token bind challenge + list endpoints. */
import { defineRoute } from "../registry.js";
import { json, jsonError, parseBodyWithSchema, handleError } from "../middleware.js";
import { ST_BIND_PREFIX, ST_PREFIX } from "../service-tokens.js";
import type { ServiceTokenBindChallenge, ServiceTokenMapping } from "../service-tokens.js";
import { tokenSchema } from "../schemas.js";
import { serviceTokenBindRequestSchema, serviceTokenBindSelfSchema } from "../validators.js";

const BIND_TTL_SECONDS = 600;

export function registerTokenRoutes(): void {
  defineRoute(
    "POST",
    "/api/v1/admin/service-tokens/bind-request",
    async (ctx, request) => {
      try {
        if (ctx.auth.type !== "human") return jsonError("Human authentication required", 403);
        const body = await parseBodyWithSchema(request, serviceTokenBindRequestSchema);
        if (body instanceof Response) return body;

        const key = `${ST_PREFIX}${body.common_name}`;
        const existing = await ctx.env.CACHE.get<ServiceTokenMapping>(key, "json");
        if (existing) return jsonError(`Service token already bound to ${existing.email}`, 409);

        const now = Math.floor(Date.now() / 1000);
        const challengeId = crypto.randomUUID();
        const challenge: ServiceTokenBindChallenge = {
          common_name: body.common_name,
          email: ctx.email,
          label: body.label ?? body.common_name,
          created_at: now,
          expires_at: now + BIND_TTL_SECONDS,
        };
        await ctx.env.CACHE.put(`${ST_BIND_PREFIX}${challengeId}`, JSON.stringify(challenge), {
          expirationTtl: BIND_TTL_SECONDS,
        });
        return json({ challenge_id: challengeId, ...challenge }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Create service token bind challenge",
      description:
        "Human-authenticated step. Creates a short-lived bind challenge that must be completed by the service token itself.",
      tags: ["Admin"],
      operationId: "createServiceTokenBindRequest",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["common_name"],
              properties: {
                common_name: { type: "string", description: "CF-Access-Client-Id" },
                label: { type: "string", description: "Human-readable label" },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Bind challenge created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  challenge_id: { type: "string" },
                  common_name: { type: "string" },
                  email: { type: "string" },
                  label: { type: "string" },
                  created_at: { type: "number" },
                  expires_at: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
  );

  defineRoute(
    "POST",
    "/api/v1/admin/service-tokens/bind-self",
    async (ctx, request) => {
      try {
        if (ctx.auth.type !== "service_token") {
          return jsonError("Service token authentication required", 403);
        }
        const body = await parseBodyWithSchema(request, serviceTokenBindSelfSchema);
        if (body instanceof Response) return body;
        const challenge = await ctx.env.CACHE.get<ServiceTokenBindChallenge>(
          `${ST_BIND_PREFIX}${body.challenge_id}`,
          "json",
        );
        if (!challenge) return jsonError("Bind challenge not found or expired", 404);
        if (challenge.expires_at < Math.floor(Date.now() / 1000)) {
          await ctx.env.CACHE.delete(`${ST_BIND_PREFIX}${body.challenge_id}`);
          return jsonError("Bind challenge expired", 400);
        }
        if (challenge.common_name !== ctx.auth.common_name) {
          return jsonError("Service token does not match bind challenge", 403);
        }

        const key = `${ST_PREFIX}${ctx.auth.common_name}`;
        const existing = await ctx.env.CACHE.get<ServiceTokenMapping>(key, "json");
        if (existing) return jsonError(`Service token already bound to ${existing.email}`, 409);

        const mapping: ServiceTokenMapping = {
          email: challenge.email,
          label: challenge.label,
          created_at: Math.floor(Date.now() / 1000),
        };
        await ctx.env.CACHE.put(key, JSON.stringify(mapping));
        await ctx.env.CACHE.delete(`${ST_BIND_PREFIX}${body.challenge_id}`);
        return json({ common_name: ctx.auth.common_name, ...mapping }, 201);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Complete service token self-bind",
      description:
        "Service-token-authenticated step. Completes a pending bind challenge and creates token→email mapping.",
      tags: ["Admin"],
      operationId: "completeServiceTokenBind",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["challenge_id"],
              properties: { challenge_id: { type: "string", format: "uuid" } },
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Service token bound",
          content: { "application/json": { schema: tokenSchema() } },
        },
      },
    },
    { allowUnboundServiceToken: true },
  );

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
