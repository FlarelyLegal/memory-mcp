import { session, type DbHandle } from "./db.js";
import type { Env } from "./types.js";

type RouteMode = "read" | "write";

type RouteOpts = {
  mode: RouteMode;
  bookmark?: string | null;
  namespaceId?: string;
  shardId?: string;
};

/**
 * Control plane tables are always centralized in env.DB.
 */
export function getControlPlaneDb(
  env: Env,
  opts: Omit<RouteOpts, "namespaceId" | "shardId">,
): DbHandle {
  const constraint: D1SessionConstraint =
    opts.mode === "write" ? "first-primary" : "first-unconstrained";
  return session(env.DB, opts.bookmark ?? constraint);
}

/**
 * Data plane DB router scaffold.
 *
 * Today this is intentionally a no-op and always returns the centralized DB.
 * Future sharding will route by namespace.shard_id to shard-specific bindings.
 */
export function getDataPlaneDb(env: Env, opts: RouteOpts): DbHandle {
  const constraint: D1SessionConstraint =
    opts.mode === "write" ? "first-primary" : "first-unconstrained";
  return session(env.DB, opts.bookmark ?? constraint);
}
