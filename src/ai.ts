/**
 * AI Gateway wrapper for Workers AI calls.
 *
 * Routes all env.AI.run() calls through AI Gateway for analytics,
 * caching, rate limiting, and logging. Uses the native binding approach —
 * no additional packages or API tokens needed.
 *
 * Gateway ID is read from env.AI_GATEWAY_ID (set per-worker) with a
 * compile-time fallback. When absent (e.g. local dev), calls go direct.
 */

/** Default gateway — used when env.AI_GATEWAY_ID is not set. */
const DEFAULT_GATEWAY = "flarelylegal-ai-gateway";

/** Gateway options injected into every AI.run() call. */
function gatewayOpts(gatewayId?: string): { gateway: { id: string } } | undefined {
  const id = gatewayId || DEFAULT_GATEWAY;
  return id ? { gateway: { id } } : undefined;
}

/**
 * Thin wrapper that calls ai.run() with AI Gateway routing.
 * Signature mirrors Ai["run"] but injects the gateway option automatically.
 */
export function aiRun(
  ai: Ai,
  model: Parameters<Ai["run"]>[0],
  input: Parameters<Ai["run"]>[1],
  gatewayId?: string,
): ReturnType<Ai["run"]> {
  const opts = gatewayOpts(gatewayId);
  return ai.run(model, input, opts);
}
