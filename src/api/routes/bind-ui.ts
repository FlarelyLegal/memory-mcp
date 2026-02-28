/**
 * Service token bind UI -- route definitions.
 *
 * GET  /api/v1/admin/service-tokens/bind  -- HTML page
 * POST /api/v1/admin/service-tokens/bind  -- combined bind (both steps)
 *
 * The POST endpoint validates service token credentials via a subrequest
 * to the Worker's own Access-protected /health URL, then writes the KV
 * mapping. The browser only needs its cookie (human identity proof).
 */
import { defineRoute } from "../registry.js";
import { handleError, jsonError } from "../middleware.js";
import { ST_PREFIX, decodeServiceToken, encodeServiceToken } from "../service-tokens.js";
import { enforceAuthRateLimit } from "../rate-limit.js";
import { writeAuditEvent } from "../audit.js";
import { renderBindPage } from "./bind-ui-html.js";

/** Register GET (HTML page) + POST (combined bind) routes. */
export function registerBindUiRoutes(): void {
  // --- GET: serve the HTML page ---
  defineRoute(
    "GET",
    "/api/v1/admin/service-tokens/bind",
    async (ctx) => {
      try {
        const nonce = crypto.randomUUID();
        return renderBindPage(ctx.email, nonce);
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Service token bind UI",
      description: "Self-service HTML page for binding and managing service tokens.",
      tags: ["Admin"],
      operationId: "getServiceTokenBindUI",
      responses: { "200": { description: "HTML page" } },
    },
  );

  // --- POST: combined bind (both steps, server-side) ---
  defineRoute(
    "POST",
    "/api/v1/admin/service-tokens/bind",
    async (ctx, request) => {
      try {
        if (ctx.auth.type !== "human") return jsonError("Human authentication required", 403);
        const rl = await enforceAuthRateLimit(ctx, "bind-ui");
        if (rl) return rl;

        let body: { client_id?: string; client_secret?: string; label?: string };
        try {
          body = await request.json();
        } catch {
          return jsonError("Invalid JSON body", 400);
        }

        const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
        const clientSecret =
          typeof body.client_secret === "string" ? body.client_secret.trim() : "";
        const label = typeof body.label === "string" ? body.label.trim() : "";
        if (!clientId || !clientSecret) {
          return jsonError("client_id and client_secret are required", 400);
        }
        if (clientId.length > 100 || clientSecret.length > 200 || label.length > 100) {
          return jsonError("Input too long", 400);
        }

        // Check if already bound
        const key = `${ST_PREFIX}${clientId}`;
        const existing = decodeServiceToken(
          await ctx.env.CACHE.get<Record<string, unknown>>(key, "json"),
        );
        if (existing && !existing.revoked_at) {
          return jsonError(`Service token already bound to ${existing.email}`, 409);
        }

        // Validate credentials: subrequest to our own /health through Access.
        // Access sees the CF-Access-Client-Id/Secret headers and issues a JWT
        // with a common_name claim if the credentials are valid.
        const origin = new URL(request.url).origin;
        const probeRes = await fetch(`${origin}/health`, {
          headers: {
            "CF-Access-Client-Id": clientId,
            "CF-Access-Client-Secret": clientSecret,
          },
        });
        const probeJwt = probeRes.headers.get("Cf-Access-Jwt-Assertion");
        if (!probeRes.ok || !probeJwt) {
          await writeAuditEvent(ctx.env, {
            action: "service_token_bind_request_denied",
            actor_type: "human",
            email: ctx.email,
            common_name: clientId,
            reason: "invalid_credentials",
          });
          return jsonError("Invalid service token credentials", 403);
        }

        // Write the binding
        const mapping = {
          email: ctx.email,
          label: label || clientId,
          created_at: Math.floor(Date.now() / 1000),
        };
        await ctx.env.CACHE.put(key, encodeServiceToken(mapping));
        await writeAuditEvent(ctx.env, {
          action: "service_token_bound",
          actor_type: "human",
          email: ctx.email,
          common_name: clientId,
        });

        return new Response(JSON.stringify({ common_name: clientId, ...mapping }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return handleError(e);
      }
    },
    {
      summary: "Bind service token (combined)",
      description:
        "Human-authenticated endpoint that validates service token credentials " +
        "server-side and writes the binding in one step.",
      tags: ["Admin"],
      operationId: "bindServiceTokenCombined",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["client_id", "client_secret"],
              properties: {
                client_id: { type: "string", description: "CF-Access-Client-Id" },
                client_secret: { type: "string", description: "CF-Access-Client-Secret" },
                label: { type: "string", description: "Human-readable label" },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Service token bound" },
        "403": { description: "Invalid credentials or not human-authenticated" },
        "409": { description: "Token already bound" },
      },
    },
  );
}
