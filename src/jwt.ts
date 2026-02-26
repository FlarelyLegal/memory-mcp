/** JWT parsing, JWKS fetching, and token verification for Cloudflare Access. */
import type { Env } from "./types.js";

/** Decode a base64url string to a UTF-8 string. */
function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  return atob(base64);
}

/** Decode a base64url string to a Uint8Array. */
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

async function fetchAccessPublicKey(env: Env, kid: string): Promise<CryptoKey> {
  if (!env.ACCESS_JWKS_URL) {
    throw new Error("ACCESS_JWKS_URL not configured");
  }
  // ACCESS_JWKS_URL may be comma-separated (e.g. team-level + SaaS app JWKS).
  const urls = env.ACCESS_JWKS_URL.split(",").map((s) => s.trim());
  for (const url of urls) {
    const resp = await fetch(url);
    const keys = (await resp.json()) as {
      keys: (JsonWebKey & { kid: string })[];
    };
    const jwk = keys.keys.find((key) => key.kid === kid);
    if (jwk) {
      return crypto.subtle.importKey(
        "jwk",
        jwk,
        { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
        false,
        ["verify"],
      );
    }
  }
  throw new Error(`No matching JWK found for kid: ${kid}`);
}

/** Verify a Cloudflare Access ID token and return its claims. */
export async function verifyToken(env: Env, token: string): Promise<Record<string, unknown>> {
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
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp < nowSec) {
    throw new Error("expired token");
  }

  // Validate audience claim against allowed Access application AUD tags.
  // ACCESS_AUD_TAG may be a single tag or comma-separated list (e.g. self-hosted + SaaS app).
  if (env.ACCESS_AUD_TAG) {
    const allowedAuds = env.ACCESS_AUD_TAG.split(",").map((s) => s.trim());
    const tokenAuds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!tokenAuds.some((a: string) => allowedAuds.includes(a))) {
      throw new Error("invalid audience");
    }
  }

  return claims;
}
