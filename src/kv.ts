/**
 * Typed KV payload helpers with schema versioning.
 *
 * Every JSON payload stored in KV includes a `v` field for safe future
 * migrations. Decode helpers return `null` on malformed data (fail-closed).
 *
 * Payload versions:
 *   - "1.0" -- initial versioned format
 *
 * KV namespaces and their key patterns:
 *   - USERS: `<email>` -> IdentityPayload
 *   - FLAGS: `admin:emails` -> AdminEmailsPayload
 *   - CACHE: `st:<common_name>` -> ServiceTokenPayload
 *   - CACHE: `stbind:<uuid>` -> BindChallengePayload
 */

import type { NamespaceRole, UserIdentity } from "./types.js";

// ---------------------------------------------------------------------------
// Version constant
// ---------------------------------------------------------------------------

const V1 = "1.0" as const;

// ---------------------------------------------------------------------------
// FLAGS: admin:emails
// ---------------------------------------------------------------------------

export interface AdminEmailsPayload {
  v: typeof V1;
  emails: string[];
}

/**
 * Decode the `admin:emails` KV value.
 * Expects JSON: `{ "v": "1.0", "emails": [...] }`.
 * Returns empty array on missing/malformed data (fail-closed).
 */
export function decodeAdminEmails(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== V1 || !Array.isArray(rec.emails)) return [];
    return (rec.emails as unknown[])
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim().toLowerCase());
  } catch {
    return [];
  }
}

/** Encode admin emails as versioned JSON. */
export function encodeAdminEmails(emails: string[]): string {
  const payload: AdminEmailsPayload = { v: V1, emails };
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// USERS: identity cache
// ---------------------------------------------------------------------------

export interface IdentityPayload extends UserIdentity {
  v: typeof V1;
}

/**
 * Decode a cached identity from KV.
 * Expects JSON with `v: "1.0"` and valid UserIdentity shape.
 * Returns null on missing/malformed data (triggers D1 re-fetch).
 */
export function decodeIdentity(raw: unknown): UserIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.v !== V1) return null;

  const groups = Array.isArray(rec.groups)
    ? rec.groups.filter((v): v is string => typeof v === "string")
    : null;
  const ownedNamespaces = Array.isArray(rec.ownedNamespaces)
    ? rec.ownedNamespaces.filter((v): v is string => typeof v === "string")
    : null;

  if (!groups || !ownedNamespaces) return null;

  const directGrants = parseGrants(rec.directGrants);
  const groupGrants = parseGrants(rec.groupGrants);
  if (!directGrants || !groupGrants) return null;

  return { groups, isAdmin: Boolean(rec.isAdmin), ownedNamespaces, directGrants, groupGrants };
}

function isNamespaceRole(v: unknown): v is NamespaceRole {
  return v === "viewer" || v === "editor" || v === "owner";
}

function parseGrants(raw: unknown): Record<string, NamespaceRole> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>).filter(([, role]) =>
    isNamespaceRole(role),
  ) as [string, NamespaceRole][];
  return Object.fromEntries(entries);
}

/** Encode a UserIdentity as versioned JSON for KV storage. */
export function encodeIdentity(identity: UserIdentity): string {
  const payload: IdentityPayload = { v: V1, ...identity };
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// CACHE: service token mapping
// ---------------------------------------------------------------------------

export interface ServiceTokenPayloadV1 {
  v: typeof V1;
  email: string;
  label: string;
  created_at: number;
  revoked_at?: number;
}

/**
 * Decode a service token mapping from KV.
 * Expects JSON with `v: "1.0"` and valid fields.
 * Returns null on missing/malformed data.
 */
export function decodeServiceToken(raw: unknown): ServiceTokenPayloadV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.v !== V1) return null;
  if (typeof rec.email !== "string" || typeof rec.label !== "string") return null;
  if (typeof rec.created_at !== "number") return null;
  return {
    v: V1,
    email: rec.email,
    label: rec.label,
    created_at: rec.created_at,
    ...(typeof rec.revoked_at === "number" && { revoked_at: rec.revoked_at }),
  };
}

/** Encode a service token mapping as versioned JSON. */
export function encodeServiceToken(mapping: Omit<ServiceTokenPayloadV1, "v">): string {
  const payload: ServiceTokenPayloadV1 = { v: V1, ...mapping };
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// CACHE: bind challenge
// ---------------------------------------------------------------------------

export interface BindChallengePayloadV1 {
  v: typeof V1;
  common_name: string;
  email: string;
  label: string;
  created_at: number;
  expires_at: number;
}

/**
 * Decode a bind challenge from KV.
 * Expects JSON with `v: "1.0"` and valid fields.
 * Returns null on missing/malformed data.
 */
export function decodeBindChallenge(raw: unknown): BindChallengePayloadV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.v !== V1) return null;
  if (typeof rec.common_name !== "string") return null;
  if (typeof rec.email !== "string") return null;
  if (typeof rec.label !== "string") return null;
  if (typeof rec.created_at !== "number") return null;
  if (typeof rec.expires_at !== "number") return null;
  return {
    v: V1,
    common_name: rec.common_name,
    email: rec.email,
    label: rec.label,
    created_at: rec.created_at,
    expires_at: rec.expires_at,
  };
}

/** Encode a bind challenge as versioned JSON. */
export function encodeBindChallenge(challenge: Omit<BindChallengePayloadV1, "v">): string {
  const payload: BindChallengePayloadV1 = { v: V1, ...challenge };
  return JSON.stringify(payload);
}
