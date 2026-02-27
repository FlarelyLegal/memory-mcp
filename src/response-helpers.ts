/** Shared response helpers for MCP tool handlers. */

export function txt(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function ok(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

export function cap(n: number | undefined, max: number, def: number) {
  return Math.min(n ?? def, max);
}

export function trunc(value: string | null | undefined, max = 400): string | null | undefined {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export function pickFields<T extends Record<string, unknown>>(
  row: T,
  fields: readonly string[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const field of fields) {
    if (field in row) {
      out[field as keyof T] = row[field] as T[keyof T];
    }
  }
  return out;
}
