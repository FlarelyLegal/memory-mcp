/**
 * Cloudflare Access OAuth handler.
 * Handles /authorize, POST /authorize, /callback, and /api/* routes to bridge
 * the MCP OAuth flow with Cloudflare Access as the upstream IdP.
 */
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import type { Env, AuthProps } from "./types.js";
import { handleApiRequest } from "./api/index.js";
import {
  addApprovedClient,
  createOAuthState,
  fetchUpstreamAuthToken,
  generateCSRFProtection,
  getUpstreamAuthorizeUrl,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./oauth/index.js";
import { verifyToken } from "./jwt.js";
import {
  VERSION,
  SERVER_NAME,
  SERVER_DISPLAY_NAME,
  SERVER_DESCRIPTION,
  REPO_URL,
} from "./version.js";

/** Default security headers applied to all responses from this handler. */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/**
 * Strict fallback CSP for non-HTML and routes without custom policies.
 * Route-specific handlers can set their own CSP and it will be preserved.
 */
const DEFAULT_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Attach security headers to a response. */
function withSecurityHeaders(response: Response): Response {
  const patched = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    patched.headers.set(k, v);
  }
  if (!patched.headers.has("Content-Security-Policy")) {
    patched.headers.set("Content-Security-Policy", DEFAULT_CSP);
  }
  return patched;
}

export async function handleAccessRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return withSecurityHeaders(await handleRequest(request, env, ctx));
}

async function handleRequest(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);

  if (request.method === "GET" && pathname === "/authorize") {
    const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const { clientId } = oauthReqInfo;
    if (!clientId) {
      return new Response("Invalid request", { status: 400 });
    }

    if (await isClientApproved(request, clientId, env.COOKIE_ENCRYPTION_KEY)) {
      const { stateToken } = await createOAuthState(oauthReqInfo, env.OAUTH_KV);
      return redirectToAccess(request, env, stateToken);
    }

    const { token: csrfToken, setCookie } = generateCSRFProtection();

    return renderApprovalDialog(request, {
      client: await env.OAUTH_PROVIDER.lookupClient(clientId),
      csrfToken,
      server: {
        description: SERVER_DESCRIPTION,
        name: SERVER_DISPLAY_NAME,
      },
      setCookie,
      state: { oauthReqInfo },
    });
  }

  if (request.method === "POST" && pathname === "/authorize") {
    try {
      const formData = await request.formData();
      validateCSRFToken(formData, request);

      const encodedState = formData.get("state");
      if (!encodedState || typeof encodedState !== "string") {
        return new Response("Missing state in form data", { status: 400 });
      }

      let state: { oauthReqInfo?: AuthRequest };
      try {
        state = JSON.parse(atob(encodedState));
      } catch {
        return new Response("Invalid state data", { status: 400 });
      }

      if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
        return new Response("Invalid request", { status: 400 });
      }

      const approvedClientCookie = await addApprovedClient(
        request,
        state.oauthReqInfo.clientId,
        env.COOKIE_ENCRYPTION_KEY,
      );

      const { stateToken } = await createOAuthState(state.oauthReqInfo, env.OAUTH_KV);

      return redirectToAccess(request, env, stateToken, {
        "Set-Cookie": approvedClientCookie,
      });
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("POST /authorize error:", error);
      if (error instanceof OAuthError) {
        return error.toResponse();
      }
      return new Response("Internal server error", { status: 500 });
    }
  }

  if (request.method === "GET" && pathname === "/callback") {
    let oauthReqInfo: AuthRequest;

    try {
      const result = await validateOAuthState(request, env.OAUTH_KV);
      oauthReqInfo = result.oauthReqInfo;
    } catch (error: unknown) {
      if (error instanceof OAuthError) {
        return error.toResponse();
      }
      return new Response("Internal server error", { status: 500 });
    }

    if (!oauthReqInfo.clientId) {
      return new Response("Invalid OAuth request data", { status: 400 });
    }

    const [accessToken, idToken, errResponse] = await fetchUpstreamAuthToken({
      client_id: env.ACCESS_CLIENT_ID,
      client_secret: env.ACCESS_CLIENT_SECRET,
      code: searchParams.get("code") ?? undefined,
      redirect_uri: new URL("/callback", request.url).href,
      upstream_url: env.ACCESS_TOKEN_URL,
    });
    if (errResponse) {
      return errResponse;
    }

    const idTokenClaims = await verifyToken(env, idToken);
    const user = {
      email: idTokenClaims.email as string,
      name: (idTokenClaims.name as string) || (idTokenClaims.email as string),
      sub: idTokenClaims.sub as string,
    };

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      metadata: {
        label: user.name,
      },
      props: {
        accessToken,
        email: user.email,
        login: user.sub,
        name: user.name,
      } as AuthProps,
      request: oauthReqInfo,
      scope: oauthReqInfo.scope,
      userId: user.sub,
    });

    return Response.redirect(redirectTo, 302);
  }

  // REST API — /api/* routes handled by the API layer
  if (pathname.startsWith("/api/") || pathname === "/api") {
    return handleApiRequest(request, env);
  }

  if (pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok", server: SERVER_NAME, version: VERSION }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/") {
    return new Response(
      `${SERVER_DISPLAY_NAME} v${VERSION}\n${SERVER_DESCRIPTION}\n\n${REPO_URL}\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  return new Response("Not Found", { status: 404 });
}

function redirectToAccess(
  request: Request,
  env: Env,
  stateToken: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id: env.ACCESS_CLIENT_ID,
        redirect_uri: new URL("/callback", request.url).href,
        scope: "openid email profile",
        state: stateToken,
        upstream_url: env.ACCESS_AUTHORIZATION_URL,
      }),
    },
    status: 302,
  });
}
