// Utility helpers

export function generateId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function toJson(obj: Record<string, unknown> | null | undefined): string | null {
  if (obj == null) return null;
  return JSON.stringify(obj);
}

/** Convert a Unix epoch (seconds) to an ISO 8601 string. */
export function toISO(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

/** Split an array into chunks of the given size. */
export function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Escape FTS5 special characters and add prefix matching for each term.
 * Produces an FTS5 query like `"term1"* "term2"*` (implicit AND, prefix match).
 */
export function ftsEscape(query: string): string {
  const terms = query
    .replace(/[":(){}[\]^~*\\]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"*`).join(" ");
}

/**
 * Temporal decay scoring.
 * Returns a value in [0, 1] where 1 = just accessed, approaching 0 as time passes.
 *
 * Uses exponential decay: score = e^(-lambda * age_hours)
 * Default half-life is 7 days (168 hours), so after 7 days the time component is ~0.5.
 */
export function decayScore(
  lastAccessedAt: number,
  importance: number,
  halfLifeHours: number = 168,
): number {
  const ageSeconds = now() - lastAccessedAt;
  const ageHours = ageSeconds / 3600;
  const lambda = Math.LN2 / halfLifeHours;
  const timeFactor = Math.exp(-lambda * ageHours);
  // Blend importance (weight 0.4) with recency (weight 0.6)
  return importance * 0.4 + timeFactor * 0.6;
}
