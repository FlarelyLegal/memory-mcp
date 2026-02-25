/**
 * Cloudflare Access OAuth handler.
 * Handles /authorize, POST /authorize, and /callback routes to bridge
 * the MCP OAuth flow with Cloudflare Access as the upstream IdP.
 */
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import type { Env, AuthProps } from "./types.js";
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

export async function handleAccessRequest(
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
        description: "Memory Graph MCP Server — persistent structured memory for LLMs.",
        name: "Memory Graph MCP",
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
      return new Response(
        `Internal server error: ${error instanceof Error ? error.message : "unknown"}`,
        { status: 500 },
      );
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

  if (pathname === "/health") {
    return new Response(
      JSON.stringify({ status: "ok", server: "memory-graph-mcp", version: "0.1.0" }),
      { headers: { "content-type": "application/json" } },
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
