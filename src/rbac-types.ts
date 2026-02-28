export type GroupRole = "owner" | "admin" | "member";
export type NamespaceRole = "owner" | "editor" | "viewer";
export type GroupPrivacy = "visible" | "hidden";
export type MemberStatus = "pending" | "active" | "suspended";
export type GrantStatus = "active" | "expired" | "revoked" | "suspended";

export interface GroupRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar_url: string | null;
  privacy: GroupPrivacy;
  parent_group_id: string | null;
  settings: string | null;
  member_count: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface GroupMemberRow {
  id: string;
  group_id: string;
  email: string;
  role: GroupRole;
  status: MemberStatus;
  invited_by: string | null;
  invited_at: number | null;
  accepted_at: number | null;
  expires_at: number | null;
  metadata: string | null;
  added_at: number;
}

export interface NamespaceGrantRow {
  id: string;
  namespace_id: string;
  email: string | null;
  group_id: string | null;
  role: NamespaceRole;
  status: GrantStatus;
  expires_at: number | null;
  inherited_from: string | null;
  condition: string | null;
  granted_by: string;
  revoked_by: string | null;
  revoked_at: number | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface Group {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar_url: string | null;
  privacy: GroupPrivacy;
  parent_group_id: string | null;
  settings: Record<string, unknown> | null;
  member_count: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface GroupMember {
  id: string;
  group_id: string;
  email: string;
  role: GroupRole;
  status: MemberStatus;
  invited_by: string | null;
  invited_at: number | null;
  accepted_at: number | null;
  expires_at: number | null;
  metadata: Record<string, unknown> | null;
  added_at: number;
}

export interface NamespaceGrant {
  id: string;
  namespace_id: string;
  email: string | null;
  group_id: string | null;
  role: NamespaceRole;
  status: GrantStatus;
  expires_at: number | null;
  inherited_from: string | null;
  condition: Record<string, unknown> | null;
  granted_by: string;
  revoked_by: string | null;
  revoked_at: number | null;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface UserIdentity {
  groups: string[];
  isAdmin: boolean;
  ownedNamespaces: string[];
  directGrants: Record<string, NamespaceRole>;
  groupGrants: Record<string, NamespaceRole>;
}
