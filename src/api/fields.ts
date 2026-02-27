/** Helpers for lightweight field projection on list/search endpoints. */

export interface FieldPresets {
  compact: readonly string[];
  full: readonly string[];
}

export function parseFields(
  query: URLSearchParams,
  allowed: readonly string[],
  presets?: FieldPresets,
): string[] | null {
  const raw = query.get("fields");
  if (!raw) {
    return null;
  }
  if (raw === "compact" && presets) return presets.compact.filter((f) => allowed.includes(f));
  if (raw === "full" && presets) return presets.full.filter((f) => allowed.includes(f));
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

export function parseCursor(query: URLSearchParams): number {
  const raw = query.get("cursor");
  if (!raw) return 0;
  const decoded = Number.parseInt(atob(raw), 10);
  if (Number.isNaN(decoded) || decoded < 0) return 0;
  return decoded;
}

export function nextCursor(offset: number, pageSize: number, hasMore: boolean): string | null {
  if (!hasMore) return null;
  return btoa(String(offset + pageSize));
}
