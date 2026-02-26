/** Service token types and constants shared across middleware and route files. */

/** KV key prefix for service token → email mappings. */
export const ST_PREFIX = "st:";

/** Shape of a service token mapping stored in KV. */
export interface ServiceTokenMapping {
  email: string;
  label: string;
  created_at: number;
}
