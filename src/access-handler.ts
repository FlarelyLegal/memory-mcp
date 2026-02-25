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
} from "./workers-oauth-utils.js";

type EnvWithOauth = Env;

export async function handleAccessRequest(
  request: Request,
  env: EnvWithOauth,
  _ctx: ExecutionContext,
): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);

  if (request.method === "GET" && pathname === "/authorize") {
    const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const { clientId } = oauthReqInfo;
    if (!clientId) {
      return new Response("Invalid request", { status: 400 });
    }

    // Check if client is already approved
    if (await isClientApproved(request, clientId, env.COOKIE_ENCRYPTION_KEY)) {
      const { stateToken } = await createOAuthState(oauthReqInfo, env.OAUTH_KV);
      return redirectToAccess(request, env, stateToken);
    }

    // Generate CSRF protection for the approval form
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

    // Exchange the code for an access token
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

    // Return back to the MCP client a new token
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

  // Health endpoint passes through the OAuthProvider wrapper, so handle it here too
  if (pathname === "/health") {
    return new Response(
      JSON.stringify({ status: "ok", server: "memory-graph-mcp", version: "0.1.0" }),
      { headers: { "content-type": "application/json" } },
    );
  }

  return new Response("Not Found", { status: 404 });
}

// --- Token verification helpers ---

async function redirectToAccess(
  request: Request,
  env: Env,
  stateToken: string,
  headers: Record<string, string> = {},
): Promise<Response> {
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

async function fetchAccessPublicKey(env: Env, kid: string): Promise<CryptoKey> {
  if (!env.ACCESS_JWKS_URL) {
    throw new Error("ACCESS_JWKS_URL not configured");
  }
  const resp = await fetch(env.ACCESS_JWKS_URL);
  const keys = (await resp.json()) as {
    keys: (JsonWebKey & { kid: string })[];
  };
  const jwk = keys.keys.filter((key) => key.kid === kid)[0];
  if (!jwk) {
    throw new Error(`No matching JWK found for kid: ${kid}`);
  }
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
    false,
    ["verify"],
  );
}

/** Decode a base64url string to a UTF-8 string */
function base64urlDecode(input: string): string {
  // Convert base64url to base64
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // Pad with = if needed
  while (base64.length % 4 !== 0) base64 += "=";
  return atob(base64);
}

/** Decode a base64url string to a Uint8Array */
function base64urlToBytes(input: string): Uint8Array {
  const str = base64urlDecode(input);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

function parseJWT(token: string) {
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    throw new Error("token must have 3 parts");
  }
  return {
    data: `${tokenParts[0]}.${tokenParts[1]}`,
    header: JSON.parse(base64urlDecode(tokenParts[0])),
    payload: JSON.parse(base64urlDecode(tokenParts[1])),
    signature: tokenParts[2],
  };
}

async function verifyToken(env: Env, token: string): Promise<Record<string, unknown>> {
  const jwt = parseJWT(token);
  const key = await fetchAccessPublicKey(env, jwt.header.kid);

  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64urlToBytes(jwt.signature),
    new TextEncoder().encode(jwt.data),
  );

  if (!verified) {
    throw new Error("failed to verify token");
  }

  const claims = jwt.payload;
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) {
    throw new Error("expired token");
  }

  return claims;
}
