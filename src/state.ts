/** Session state helpers for MCP tool handlers. */

import type { StateHandle } from "./types.js";

const MAX_RECENT = 10;

/** Update session state after a tool accesses domain objects. */
export function track(
  handle: StateHandle,
  updates: {
    namespace?: string;
    entity?: string | string[];
    conversation?: string;
  },
): void {
  const s = handle.state;
  const next = { ...s };
  let changed = false;

  if (updates.namespace && updates.namespace !== s.currentNamespace) {
    next.currentNamespace = updates.namespace;
    changed = true;
  }

  if (updates.conversation && updates.conversation !== s.currentConversation) {
    next.currentConversation = updates.conversation;
    changed = true;
  }

  if (updates.entity) {
    const ids = Array.isArray(updates.entity) ? updates.entity : [updates.entity];
    const recent = [...s.recentEntities];
    for (const id of ids) {
      const idx = recent.indexOf(id);
      if (idx !== -1) recent.splice(idx, 1);
      recent.unshift(id);
    }
    if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
    if (recent.join() !== s.recentEntities.join()) {
      next.recentEntities = recent;
      changed = true;
    }
  }

  if (changed) handle.setState(next);
}

/** Remove an entity from recentEntities (after deletion). */
export function untrack(handle: StateHandle, entityId: string): void {
  const s = handle.state;
  const idx = s.recentEntities.indexOf(entityId);
  if (idx === -1) return;
  handle.setState({
    ...s,
    recentEntities: s.recentEntities.filter((id) => id !== entityId),
  });
}

/** Resolve namespace_id: use explicit value, fall back to session state, or return undefined. */
export function resolveNamespace(
  explicit: string | undefined,
  handle: StateHandle,
): string | undefined {
  return explicit || handle.state.currentNamespace;
}

/** Resolve conversation_id: use explicit value, fall back to session state, or return undefined. */
export function resolveConversation(
  explicit: string | undefined,
  handle: StateHandle,
): string | undefined {
  return explicit || handle.state.currentConversation;
}
