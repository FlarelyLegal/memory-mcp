/**
 * HTML renderer for the namespace list view.
 *
 * Card grid showing all accessible namespaces with name, owner,
 * visibility badge, entity/memory/relation counts, and created date.
 * Each card links to the namespace detail page.
 */
import { htmlPage, esc, fmtDate } from "./layout.js";
import type { NamespaceStats } from "../../stats.js";

interface NamespaceView {
  id: string;
  name: string;
  owner: string | null;
  visibility: string | null;
  description: string | null;
  created_at: string | null;
}

export function renderNamespaceList(
  namespaces: NamespaceView[],
  statsMap: Map<string, NamespaceStats>,
): Response {
  if (namespaces.length === 0) {
    return htmlPage(`<header><h1>Namespaces</h1><p>No namespaces found.</p></header>`, {
      title: "Namespaces",
      breadcrumbs: [
        { label: "Home", href: "/" },
        { label: "API", href: "/api/docs" },
        { label: "Namespaces" },
      ],
    });
  }

  const cards = namespaces
    .map((ns) => {
      const s = statsMap.get(ns.id);
      const vis = ns.visibility ?? "private";
      const badgeClass = vis === "public" ? "badge-public" : "badge-private";
      return `<div class="card">
<a href="/api/v1/namespaces/${esc(ns.id)}">
  <div class="card-title">${esc(ns.name)}<span class="badge ${badgeClass}">${esc(vis)}</span></div>
  <div class="card-meta">${esc(ns.owner ?? "unowned")} -- ${fmtDate(ns.created_at)}</div>
  ${ns.description ? `<div class="card-meta">${esc(ns.description)}</div>` : ""}
  <div class="stats">
    <span class="stat"><strong>${s?.entity_count ?? 0}</strong> entities</span>
    <span class="stat"><strong>${s?.memory_count ?? 0}</strong> memories</span>
    <span class="stat"><strong>${s?.relation_count ?? 0}</strong> relations</span>
    <span class="stat"><strong>${s?.conversation_count ?? 0}</strong> conversations</span>
  </div>
</a>
</div>`;
    })
    .join("\n");

  const body = `<header>
<h1>Namespaces</h1>
<p>${namespaces.length} namespace${namespaces.length !== 1 ? "s" : ""}</p>
</header>
<div class="card-grid">
${cards}
</div>`;

  return htmlPage(body, {
    title: "Namespaces",
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "API", href: "/api/docs" },
      { label: "Namespaces" },
    ],
  });
}
