/** Helpers for lightweight field projection on list/search endpoints. */

export function parseFields(query: URLSearchParams, allowed: readonly string[]): string[] | null {
  const raw = query.get("fields");
  if (!raw) return null;
  const requested = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (requested.length === 0) return null;
  return requested.filter((f) => allowed.includes(f));
}

export function projectRows<T extends object>(rows: T[], fields: string[] | null): T[] {
  if (!fields || fields.length === 0) return rows;
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in row) out[field] = (row as Record<string, unknown>)[field];
    }
    return out as T;
  });
}
