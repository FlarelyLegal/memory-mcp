export type AuditAction =
  | "namespace.create"
  | "namespace.update"
  | "namespace.delete"
  | "namespace.claim"
  | "namespace.set_visibility"
  | "namespace.transfer"
  | "namespace_grant.create"
  | "namespace_grant.revoke"
  | "entity.create"
  | "entity.update"
  | "entity.delete"
  | "relation.create"
  | "relation.delete"
  | "memory.create"
  | "memory.update"
  | "memory.delete"
  | "conversation.create"
  | "conversation.delete"
  | "message.create"
  | "workflow.reindex"
  | "workflow.consolidate"
  | "audit.purge"
  | "service_token.bind_request"
  | "service_token.bind_self"
  | "service_token.bind_denied"
  | "service_token.bind_conflict"
  | "service_token.update"
  | "service_token.revoke"
  | "group.create"
  | "group.update"
  | "group.delete"
  | "group_member.add"
  | "group_member.remove"
  | "group_member.update_role";

export type ResourceType =
  | "namespace"
  | "entity"
  | "relation"
  | "memory"
  | "conversation"
  | "message"
  | "service_token"
  | "workflow"
  | "group"
  | "group_member";

export interface AuditEntry {
  action: AuditAction;
  email: string;
  namespace_id?: string | null;
  resource_type?: ResourceType | null;
  resource_id?: string | null;
  detail?: Record<string, unknown> | null;
}
