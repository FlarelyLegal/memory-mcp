/**
 * Route registry — collects API route definitions and their OpenAPI specs.
 *
 * Each route module calls `register()` to add its routes. The registry is
 * then used by the router (to match requests) and by the OpenAPI assembler
 * (to build the spec). Single source of truth for both.
 */
import type { RouteDefinition, HttpMethod, PathOperation, ApiContext } from "./types.js";

const routes: RouteDefinition[] = [];

/** Register one API route with its handler and OpenAPI spec. */
export function register(route: RouteDefinition): void {
  routes.push(route);
}

/** Get all registered routes (for the router and OpenAPI assembler). */
export function getRoutes(): readonly RouteDefinition[] {
  return routes;
}

/** Convert an Express-style pattern like `/api/v1/entities/:id` to a regex. */
function patternToRegex(pattern: string): RegExp {
  const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, "(?<$1>[^/]+)");
  return new RegExp(`^${regexStr}$`);
}

/** Match a request against registered routes. Returns the route + extracted params. */
export function matchRoute(
  method: HttpMethod,
  pathname: string,
): { route: RouteDefinition; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const regex = patternToRegex(route.pattern);
    const match = pathname.match(regex);
    if (match) {
      return { route, params: match.groups ?? {} };
    }
  }
  return null;
}

/** Helper to define a route with less boilerplate. */
export function defineRoute(
  method: HttpMethod,
  pattern: string,
  handler: (ctx: ApiContext, request: Request) => Promise<Response>,
  spec: PathOperation,
  options?: { public?: boolean; allowUnboundServiceToken?: boolean },
): void {
  register({
    method,
    pattern,
    handler,
    spec,
    public: options?.public,
    allowUnboundServiceToken: options?.allowUnboundServiceToken,
  });
}
