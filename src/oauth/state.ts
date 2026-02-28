/** OAuth state management and upstream IdP communication. */
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { OAuthError } from "./error.js";

export interface OAuthStateResult {
  stateToken: string;
}

export interface ValidateStateResult {
  oauthReqInfo: AuthRequest;
  clearCookie: string;
}

export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  stateTTL = 600,
): Promise<OAuthStateResult> {
  const stateToken = crypto.randomUUID();
  await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: stateTTL,
  });
  return { stateToken };
}

export async function validateOAuthState(
  request: Request,
  kv: KVNamespace,
): Promise<ValidateStateResult> {
  const url = new URL(request.url);
  const stateFromQuery = url.searchParams.get("state");

  if (!stateFromQuery) {
    throw new OAuthError("invalid_request", "Missing state parameter", 400);
  }

  const oauthReqInfo = await kv.get<AuthRequest>(`oauth:state:${stateFromQuery}`, "json");
  if (!oauthReqInfo) {
    throw new OAuthError("invalid_request", "Invalid or expired state", 400);
  }

  await kv.delete(`oauth:state:${stateFromQuery}`);

  return { oauthReqInfo, clearCookie: "" };
}

export function getUpstreamAuthorizeUrl(params: {
  upstream_url: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
}): string {
  const url = new URL(params.upstream_url);
  url.searchParams.set("client_id", params.client_id);
  url.searchParams.set("redirect_uri", params.redirect_uri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function fetchUpstreamAuthToken(params: {
  upstream_url: string;
  client_id: string;
  client_secret: string;
  code?: string;
  redirect_uri: string;
}): Promise<[string, string, null] | [null, null, Response]> {
  if (!params.code) {
    return [null, null, new Response("Missing authorization code", { status: 400 })];
  }

  const data = new URLSearchParams({
    client_id: params.client_id,
    client_secret: params.client_secret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: params.redirect_uri,
  });

  const response = await fetch(params.upstream_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: data.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return [
      null,
      null,
      new Response(`Failed to exchange code for token: ${errorText}`, {
        status: response.status,
      }),
    ];
  }

  const body = (await response.json()) as Record<string, unknown>;

  const accessToken = body.access_token as string;
  if (!accessToken) {
    return [null, null, new Response("Missing access token", { status: 400 })];
  }

  const idToken = body.id_token as string;
  if (!idToken) {
    return [null, null, new Response("Missing id token", { status: 400 })];
  }
  return [accessToken, idToken, null];
}
