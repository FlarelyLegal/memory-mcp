/**
 * Consolidation step: expire grants and group memberships.
 *
 * Transitions rows past their `expires_at` from status='active' to
 * status='expired', then busts identity caches for affected users.
 */
import type { WorkflowStep } from "cloudflare:workers";
import type { Env } from "../../types.js";
import { expireGrants, expireGroupMembers } from "../../grant-expiry.js";
import { bustIdentityCaches } from "../../cache-bust.js";
import type { StepRetry } from "./types.js";

export async function stepExpireGrants(
  env: Env,
  step: WorkflowStep,
  retry: StepRetry,
): Promise<{ grantsExpired: number; membersExpired: number }> {
  return step.do("expire-grants", retry, async () => {
    const db = env.DB;
    const grantResult = await expireGrants(db);
    const memberResult = await expireGroupMembers(db);
    const allEmails = [
      ...new Set([...grantResult.affected_emails, ...memberResult.affected_emails]),
    ];
    if (allEmails.length > 0) {
      await bustIdentityCaches(env.USERS, allEmails);
    }
    return {
      grantsExpired: grantResult.expired,
      membersExpired: memberResult.expired,
    };
  });
}
