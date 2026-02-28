/**
 * OpenAPI 3.1 spec assembler.
 *
 * Builds the full spec dynamically from routes registered in the registry.
 * Adding a new route with its PathOperation spec automatically updates the
 * OpenAPI output �� no separate spec file to maintain.
 */
import { getRoutes } from "./registry.js";
import { errorBodySchema } from "./schemas.js";
import { VERSION, SERVER_DESCRIPTION, REPO_URL } from "../version.js";

/** Common security scheme reference applied to authenticated endpoints. */
const SECURITY_SCHEME = { CloudflareAccess: [] };

/** Reusable error response schemas. */
const ERROR_RESPONSES = {
  "401": {
    description: "Missing or invalid authentication",
    content: { "application/json": { schema: errorBodySchema() } },
  },
  "403": {
    description: "Access denied",
    content: { "application/json": { schema: errorBodySchema() } },
  },
  "500": {
    description: "Internal server error",
    content: { "application/json": { schema: errorBodySchema() } },
  },
};

/** Build the complete OpenAPI 3.1 spec from all registered routes. */
export function buildOpenApiSpec(serverUrl?: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of getRoutes()) {
    // Convert Express-style :param to OpenAPI {param}
    const openApiPath = route.pattern.replace(/:([a-zA-Z_]+)/g, "{$1}");
    const method = route.method.toLowerCase();

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    const operation: Record<string, unknown> = { ...route.spec };

    // Add standard error responses to authenticated endpoints
    if (!route.public) {
      operation.security = [SECURITY_SCHEME];
      operation.responses = {
        ...route.spec.responses,
        ...ERROR_RESPONSES,
      };
    }

    paths[openApiPath][method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Memory Graph API",
      description: SERVER_DESCRIPTION,
      version: VERSION,
      license: { name: "AGPL-3.0-only", url: `${REPO_URL}/blob/main/LICENSE` },
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    paths,
    components: {
      securitySchemes: {
        CloudflareAccess: {
          type: "apiKey",
          in: "header",
          name: "Cf-Access-Jwt-Assertion",
          description:
            "Cloudflare Access JWT (`Cf-Access-Jwt-Assertion` preferred, `cf-access-token` supported). " +
            "For service-to-service auth, create a " +
            "Cloudflare Access Service Token. Access validates the credentials " +
            "and injects a signed JWT via this header automatically.",
        },
      },
    },
    tags: buildTags(),
  };
}

function buildTags() {
  const tagMap: Record<string, string> = {
    Namespaces: "Memory namespace management (scopes for organizing data)",
    Entities: "Knowledge graph entity CRUD",
    Relations: "Directed relations between entities",
    Traversal: "Graph traversal (BFS)",
    Memories: "Persistent memory fragments with temporal decay",
    Conversations: "Conversation and message history",
    Search: "Semantic vector search",
    Admin: "Administrative operations (reindex, claim)",
  };
  return Object.entries(tagMap).map(([name, description]) => ({
    name,
    description,
  }));
}
