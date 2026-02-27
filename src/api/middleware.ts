/**
 * API middleware: authentication, JSON helpers, error handling.
 *
 * Auth verifies the Cf-Access-Jwt-Assertion header — the signed JWT that
 * Cloudflare Access injects after validating a user session or service token.
 *
 * For human users, the JWT contains an `email` claim (from the IdP).
 * For service tokens, the JWT has no `email` but includes a `common_name`
 * claim (equal to the CF-Access-Client-Id). We resolve the service token's
 * identity via a KV lookup: `st:<common_name>` → `{email, label}`.
 */
import type { Env } from "../types.js";
import { verifyToken } from "../jwt.js";
import { AccessDeniedError } from "../auth.js";
import { ST_PREFIX } from "./service-tokens.js";
import type { ServiceTokenMapping } from "./service-tokens.js";
import type { AuthIdentity } from "./types.js";
import { z } from "zod";

/** Standard JSON success response. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Standard JSON error response. */
export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Extract the Access JWT from the request.
 *
 * Cloudflare Access provides the JWT in two ways:
 * - `Cf-Access-Jwt-Assertion` header (preferred, always present for proxied requests)
 * - `CF_Authorization` cookie (set by Access for browser and service token flows)
 */
function extractJwt(request: Request): { token: string; source: "header" | "cookie" } | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return { token: header, source: "header" };

  const rawToken = request.headers.get("cf-access-token");
  if (rawToken) return { token: rawToken, source: "header" };

  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^\s;]+)/);
  return match?.[1] ? { token: match[1], source: "cookie" } : null;
}

function isMutatingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function passesCookieCsrfCheck(request: Request): boolean {
  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  if (secFetchSite === "cross-site") return false;

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin) {
    return origin === `${url.protocol}//${url.host}`;
  }

  const referer = request.headers.get("Referer");
  if (referer) {
    return referer.startsWith(`${url.protocol}//${url.host}/`);
  }

  // Non-browser clients (e.g. curl) may omit these headers.
  return true;
}

/**
 * Authenticate a request and resolve the user's email.
 *
 * 1. Extract JWT from header or cookie.
 * 2. Verify RSA signature, expiry, and audience.
 * 3. If JWT has `email` → human user, return it directly.
 * 4. If JWT has `common_name` but no `email` → service token. Look up
 *    `st:<common_name>` in KV to resolve the bound email.
 * 5. If no KV mapping → 403 (unregistered service token).
 */
export async function authenticate(request: Request, env: Env): Promise<string | Response> {
  const identity = await authenticateIdentity(request, env);
  if (identity instanceof Response) return identity;
  if (!identity.email) {
    return jsonError("Service token not registered. Bind it to an email first.", 403);
  }
  return identity.email;
}

export async function authenticateIdentity(
  request: Request,
  env: Env,
  opts?: { allowUnboundServiceToken?: boolean },
): Promise<AuthIdentity | Response> {
  const jwt = extractJwt(request);

  if (!jwt) {
    return jsonError("Missing Cf-Access-Jwt-Assertion header", 401);
  }

  if (
    jwt.source === "cookie" &&
    isMutatingMethod(request.method) &&
    !passesCookieCsrfCheck(request)
  ) {
    return jsonError("Invalid origin for cookie-authenticated request", 403);
  }

  let claims: Record<string, unknown>;
  try {
    claims = await verifyToken(env, jwt.token);
  } catch {
    return jsonError("Invalid or expired token", 401);
  }

  // Human user — JWT contains email from IdP
  const email = claims.email as string | undefined;
  if (email) {
    return { type: "human", email };
  }

  // Service token — JWT contains common_name (= CF-Access-Client-Id)
  const commonName = claims.common_name as string | undefined;
  if (!commonName) {
    return jsonError("JWT missing email and common_name claims", 401);
  }

  const mapping = await env.CACHE.get<ServiceTokenMapping>(`${ST_PREFIX}${commonName}`, "json");
  if (!mapping) {
    if (opts?.allowUnboundServiceToken) {
      return { type: "service_token", common_name: commonName, email: null, bound: false };
    }
    return jsonError("Service token not registered. Bind it to an email first.", 403);
  }

  return { type: "service_token", common_name: commonName, email: mapping.email, bound: true };
}

/** Parse JSON body with error handling. */
export async function parseBody<T = Record<string, unknown>>(
  request: Request,
): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
}

/** Parse and validate JSON body with Zod. */
export async function parseBodyWithSchema<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | Response> {
  const parsed = await parseBody(request);
  if (parsed instanceof Response) return parsed;
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return jsonError(result.error.issues[0]?.message ?? "Invalid request body", 400);
  }
  return result.data;
}

/** Wrap a handler to catch known errors and return appropriate responses. */
export function handleError(error: unknown): Response {
  if (error instanceof AccessDeniedError) {
    return jsonError(error.message, 403);
  }
  // eslint-disable-next-line no-console
  console.error("API error:", error);
  return jsonError("Internal server error", 500);
}
