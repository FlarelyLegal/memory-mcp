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
