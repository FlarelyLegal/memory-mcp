import { type DbHandle, withRetry } from "../db.js";
import { generateId, now, toJson } from "../utils.js";
import type { NamespaceGrantRow, NamespaceRole } from "../types.js";

type GrantPrincipal = { email?: string; group_id?: string };

type GrantInput = {
  namespace_id: string;
  role: NamespaceRole;
  granted_by: string;
  expires_at?: number;
  metadata?: Record<string, unknown>;
} & GrantPrincipal;

function principalWhere(principal: GrantPrincipal): { sql: string; value: string } {
  if (principal.email) return { sql: "email = ?", value: principal.email };
  if (principal.group_id) return { sql: "group_id = ?", value: principal.group_id };
  throw new Error("grant principal must include email or group_id");
}

export async function grantAccess(db: DbHandle, input: GrantInput): Promise<string> {
  const ts = now();
  const principal = principalWhere(input);
  const existing = await db
    .prepare(
      `SELECT id FROM namespace_grants
       WHERE namespace_id = ? AND ${principal.sql} AND status = 'active'
       LIMIT 1`,
    )
    .bind(input.namespace_id, principal.value)
    .first<{ id: string }>();

  if (existing) {
    await withRetry(() =>
      db
        .prepare(
          `UPDATE namespace_grants
           SET role = ?, expires_at = ?, metadata = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(input.role, input.expires_at ?? null, toJson(input.metadata ?? null), ts, existing.id)
        .run(),
    );
    return existing.id;
  }

  const id = generateId();
  await withRetry(() =>
    db
      .prepare(
        `INSERT INTO namespace_grants
         (id, namespace_id, email, group_id, role, status, expires_at, granted_by, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.namespace_id,
        input.email ?? null,
        input.group_id ?? null,
        input.role,
        input.expires_at ?? null,
        input.granted_by,
        toJson(input.metadata ?? null),
        ts,
        ts,
      )
      .run(),
  );
  return id;
}

export async function revokeAccess(
  db: DbHandle,
  grantId: string,
  revokedBy: string,
): Promise<void> {
  const ts = now();
  await withRetry(() =>
    db
      .prepare(
        `UPDATE namespace_grants
         SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(revokedBy, ts, ts, grantId)
      .run(),
  );
}

export async function revokeAccessByPrincipal(
  db: DbHandle,
  namespaceId: string,
  principal: GrantPrincipal,
  revokedBy: string,
): Promise<void> {
  const ts = now();
  const p = principalWhere(principal);
  await withRetry(() =>
    db
      .prepare(
        `UPDATE namespace_grants
         SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ?
         WHERE namespace_id = ? AND ${p.sql} AND status = 'active'`,
      )
      .bind(revokedBy, ts, ts, namespaceId, p.value)
      .run(),
  );
}

export async function listNamespaceGrants(
  db: DbHandle,
  namespaceId: string,
): Promise<NamespaceGrantRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM namespace_grants
       WHERE namespace_id = ? AND status = 'active'
       ORDER BY created_at DESC`,
    )
    .bind(namespaceId)
    .all<NamespaceGrantRow>();
  return result.results;
}

export async function listAllNamespaceGrants(
  db: DbHandle,
  namespaceId: string,
): Promise<NamespaceGrantRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM namespace_grants
       WHERE namespace_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(namespaceId)
    .all<NamespaceGrantRow>();
  return result.results;
}
