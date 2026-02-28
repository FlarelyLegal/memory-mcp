/**
 * HTML renderer for the entity detail view.
 *
 * Entity card with name/type/summary, related entities table,
 * and linked memories table.
 */
import { htmlPage, esc, fmtDate } from "./layout.js";

interface EntityView {
  id: string;
  namespace_id: string;
  namespace_name: string;
  name: string;
  type: string;
  summary: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface RelatedEntity {
  id: string;
  name: string;
  relation_type: string;
  direction: "outgoing" | "incoming";
}

interface LinkedMemory {
  id: string;
  content: string;
  importance: number | null;
  created_at: string | null;
}

export interface EntityDetailData {
  entity: EntityView;
  relations: RelatedEntity[];
  memories: LinkedMemory[];
}

export function renderEntityDetail(data: EntityDetailData): Response {
  const e = data.entity;

  const header = `<header>
<h1>${esc(e.name)}</h1>
<p><code>${esc(e.type)}</code> -- created ${fmtDate(e.created_at)}${e.updated_at ? `, updated ${fmtDate(e.updated_at)}` : ""}</p>
${e.summary ? `<p style="margin-top:.5rem;color:#444">${esc(e.summary)}</p>` : ""}
</header>`;

  let relationsHtml: string;
  if (data.relations.length === 0) {
    relationsHtml = `<div class="card"><h2>Relations</h2><p class="empty">None</p></div>`;
  } else {
    const rows = data.relations
      .map(
        (r) =>
          `<tr><td>${esc(r.direction === "outgoing" ? "--->" : "<---")}</td>` +
          `<td><code>${esc(r.relation_type)}</code></td>` +
          `<td><a href="/api/v1/entities/${esc(r.id)}">${esc(r.name)}</a></td></tr>`,
      )
      .join("\n");
    relationsHtml = `<div class="card"><h2>Relations</h2>
<table><tr><th>Dir</th><th>Type</th><th>Entity</th></tr>${rows}</table></div>`;
  }

  let memoriesHtml: string;
  if (data.memories.length === 0) {
    memoriesHtml = `<div class="card"><h2>Linked Memories</h2><p class="empty">None</p></div>`;
  } else {
    const rows = data.memories
      .map(
        (m) =>
          `<tr><td>${esc(trunc(m.content, 120))}</td>` +
          `<td>${m.importance ?? "--"}</td>` +
          `<td>${fmtDate(m.created_at)}</td></tr>`,
      )
      .join("\n");
    memoriesHtml = `<div class="card"><h2>Linked Memories</h2>
<table><tr><th>Content</th><th>Importance</th><th>Created</th></tr>${rows}</table></div>`;
  }

  const body = `${header}${relationsHtml}${memoriesHtml}`;

  return htmlPage(body, {
    title: e.name,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "API", href: "/api/docs" },
      { label: "Namespaces", href: "/api/v1/namespaces" },
      { label: e.namespace_name, href: `/api/v1/namespaces/${e.namespace_id}` },
      { label: e.name },
    ],
  });
}

function trunc(s: string | null | undefined, max: number): string {
  if (!s) return "--";
  return s.length > max ? s.slice(0, max) + "..." : s;
}
