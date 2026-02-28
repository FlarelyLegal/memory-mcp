/** Barrel export for graph operations. */
export {
  createNamespace,
  getNamespace,
  listNamespaces,
  updateNamespace,
  updateNamespaceVisibility,
  transferNamespaceOwner,
  collectNamespaceVectorIds,
  deleteNamespace,
  claimUnownedNamespaces,
} from "./namespaces.js";
export { createEntity, getEntity, searchEntities, updateEntity, deleteEntity } from "./entities.js";
export { createRelation, getRelationsFrom, getRelationsTo, deleteRelation } from "./relations.js";
export { traverse } from "./traversal.js";
export {
  createGroup,
  getGroup,
  getGroupBySlug,
  listUserGroups,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  updateGroupMemberRole,
  listGroupMembers,
  getGroupMembership,
  getUserGroupIds,
  countGroupOwners,
  incrementMemberCount,
  generateSlug,
} from "./groups.js";
export {
  grantAccess,
  getNamespaceGrant,
  revokeAccess,
  revokeAccessByPrincipal,
  listNamespaceGrants,
  listAllNamespaceGrants,
} from "./grants.js";
export {
  MAX_GROUP_DEPTH,
  walkAncestors,
  walkDescendants,
  validateParentGroup,
  getChildGroupIds,
} from "./group-hierarchy.js";
export { resolveInheritedGrants } from "./grant-inheritance.js";
