/** Service token types and constants shared across middleware and route files. */

export {
  type ServiceTokenPayloadV1 as ServiceTokenMapping,
  type BindChallengePayloadV1 as ServiceTokenBindChallenge,
  decodeServiceToken,
  encodeServiceToken,
  decodeBindChallenge,
  encodeBindChallenge,
} from "../kv.js";

/** KV key prefix for service token → email mappings. */
export const ST_PREFIX = "st:";
export const ST_BIND_PREFIX = "stbind:";
