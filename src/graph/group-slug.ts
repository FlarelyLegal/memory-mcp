import type { DbHandle } from "../db.js";

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "group";
}

export async function generateSlug(db: DbHandle, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (true) {
    const row = await db
      .prepare(`SELECT id FROM groups WHERE slug = ? LIMIT 1`)
      .bind(slug)
      .first<{ id: string }>();
    if (!row) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}
