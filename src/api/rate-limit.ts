/** Route-level rate limiting helpers. */
import type { ApiContext } from "./types.js";
import { jsonError } from "./middleware.js";

function rateKey(ctx: ApiContext, scope: string): string {
  if (ctx.auth.type === "service_token") return `${scope}:st:${ctx.auth.common_name}`;
  return `${scope}:u:${ctx.email}`;
}

export async function enforceAuthRateLimit(
  ctx: ApiContext,
  scope: string,
): Promise<Response | null> {
  if (!ctx.env.RATE_LIMIT_AUTH) return null;
  const result = await ctx.env.RATE_LIMIT_AUTH.limit({ key: rateKey(ctx, scope) });
  if (!result.success) return jsonError("Rate limit exceeded", 429);
  return null;
}

export async function enforceSearchRateLimit(
  ctx: ApiContext,
  scope: string,
): Promise<Response | null> {
  if (!ctx.env.RATE_LIMIT_SEARCH) return null;
  const result = await ctx.env.RATE_LIMIT_SEARCH.limit({ key: rateKey(ctx, scope) });
  if (!result.success) return jsonError("Rate limit exceeded", 429);
  return null;
}
