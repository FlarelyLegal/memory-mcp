/** Barrel export for graph operations. */
export {
  createNamespace,
  getNamespace,
  listNamespaces,
  claimUnownedNamespaces,
} from "./namespaces.js";
export { createEntity, getEntity, searchEntities, updateEntity, deleteEntity } from "./entities.js";
export { createRelation, getRelationsFrom, getRelationsTo, deleteRelation } from "./relations.js";
export { traverse } from "./traversal.js";
