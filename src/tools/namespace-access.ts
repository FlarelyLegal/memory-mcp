import type { Env, NamespaceRole } from "../types.js";
import { session } from "../db.js";
import { audit } from "../audit.js";
import { assertNamespaceOwnerAccess, assertNamespaceReadAccess } from "../auth.js";
import { bustIdentityCache, bustIdentityCacheForGroup, bustIdentityCaches } from "../cache-bust.js";
import { loadIdentity } from "../identity.js";
import * as graph from "../graph/index.js";
import { err, ok, txt } from "../response-helpers.js";

type Result = ReturnType<typeof txt> | ReturnType<typeof err> | ReturnType<typeof ok>;

type Input = {
  action: "share" | "unshare" | "list_access" | "transfer";
  id?: string;
  target_email?: string;
  group_id?: string;
  role?: NamespaceRole;
  grant_id?: string;
};

export async function handleNamespaceAccessAction(
  env: Env,
  email: string,
  input: Input,
): Promise<Result | null> {
  const { action, id, target_email, group_id, role, grant_id } = input;

  if (action === "share") {
    if (!id || !role) return err("id and role required");
    if (!!target_email === !!group_id) return err("set exactly one of target_email or group_id");
    const db = session(env.DB, "first-primary");
    const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
    await assertNamespaceOwnerAccess(db, id, identity);
    const gid = await graph.grantAccess(db, {
      namespace_id: id,
      email: target_email,
      group_id,
      role,
      granted_by: email,
    });
    if (target_email) await bustIdentityCache(env.USERS, target_email);
    if (group_id) await bustIdentityCacheForGroup(db, env.USERS, group_id);
    await audit(db, env.STORAGE, {
      action: "namespace_grant.create",
      email,
      namespace_id: id,
      resource_type: "namespace",
      resource_id: id,
      detail: { grant_id: gid, role, target_email, group_id },
    });
    return txt({
      grant_id: gid,
      role,
      target_email: target_email ?? null,
      group_id: group_id ?? null,
    });
  }

  if (action === "list_access") {
    if (!id) return err("id required");
    const db = session(env.DB, "first-unconstrained");
    const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
    await assertNamespaceReadAccess(db, id, identity);
    return txt(await graph.listNamespaceGrants(db, id));
  }

  if (action === "unshare") {
    if (!id) return err("id required");
    const db = session(env.DB, "first-primary");
    const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
    await assertNamespaceOwnerAccess(db, id, identity);
    if (grant_id) {
      await graph.revokeAccess(db, grant_id, email);
    } else {
      if (!!target_email === !!group_id)
        return err("set grant_id or exactly one of target_email or group_id");
      await graph.revokeAccessByPrincipal(db, id, { email: target_email, group_id }, email);
    }
    if (target_email) await bustIdentityCache(env.USERS, target_email);
    if (group_id) await bustIdentityCacheForGroup(db, env.USERS, group_id);
    await audit(db, env.STORAGE, {
      action: "namespace_grant.revoke",
      email,
      namespace_id: id,
      resource_type: "namespace",
      resource_id: id,
      detail: { grant_id, target_email, group_id },
    });
    return ok("Access revoked");
  }

  if (action === "transfer") {
    if (!id || !target_email) return err("id and target_email required");
    if (target_email.toLowerCase() === email.toLowerCase())
      return err("namespace already owned by target");
    const db = session(env.DB, "first-primary");
    const identity = await loadIdentity(db, env.USERS, env.FLAGS, email);
    await assertNamespaceOwnerAccess(db, id, identity);
    await graph.transferNamespaceOwner(db, id, target_email);
    await bustIdentityCaches(env.USERS, [email, target_email]);
    await audit(db, env.STORAGE, {
      action: "namespace.transfer",
      email,
      namespace_id: id,
      resource_type: "namespace",
      resource_id: id,
      detail: { from: email, to: target_email },
    });
    return ok(`Namespace transferred to ${target_email}`);
  }

  return null;
}
