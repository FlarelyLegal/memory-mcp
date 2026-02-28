/**
 * HTML renderer for the namespace detail view.
 *
 * Header card with name/owner/visibility, then tables for entities,
 * memories, relations, and conversations.
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
  updated_at: string | null;
}

interface EntitySummary {
  id: string;
  name: string;
  type: string;
  summary: string | null;
  created_at: string | null;
}

interface MemorySummary {
  id: string;
  content: string;
  importance: number | null;
  created_at: string | null;
}

interface RelationSummary {
  source_name: string;
  target_name: string;
  relation_type: string;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string | null;
}

export interface NamespaceDetailData {
  namespace: NamespaceView;
  stats: NamespaceStats;
  entities: EntitySummary[];
  memories: MemorySummary[];
  relations: RelationSummary[];
  conversations: ConversationSummary[];
}

export function renderNamespaceDetail(data: NamespaceDetailData): Response {
  const ns = data.namespace;
  const vis = ns.visibility ?? "private";
  const badgeClass = vis === "public" ? "badge-public" : "badge-private";

  const header = `<header>
<h1>${esc(ns.name)}<span class="badge ${badgeClass}">${esc(vis)}</span></h1>
<p>${esc(ns.owner ?? "unowned")} -- created ${fmtDate(ns.created_at)}</p>
${ns.description ? `<p style="margin-top:.25rem;color:#444">${esc(ns.description)}</p>` : ""}
</header>`;

  const statsBar = `<div class="card">
<div class="stats">
  <span class="stat"><strong>${data.stats.entity_count}</strong> entities</span>
  <span class="stat"><strong>${data.stats.memory_count}</strong> memories</span>
  <span class="stat"><strong>${data.stats.relation_count}</strong> relations</span>
  <span class="stat"><strong>${data.stats.conversation_count}</strong> conversations</span>
  <span class="stat"><strong>${data.stats.message_count}</strong> messages</span>
</div>
</div>`;

  const entitiesHtml = sectionTable(
    "Entities",
    data.entities,
    ["Name", "Type", "Summary", "Created"],
    (e) =>
      `<tr><td><a href="/api/v1/entities/${esc(e.id)}">${esc(e.name)}</a></td>` +
      `<td><code>${esc(e.type)}</code></td>` +
      `<td>${esc(trunc(e.summary, 80))}</td>` +
      `<td>${fmtDate(e.created_at)}</td></tr>`,
  );

  const memoriesHtml = sectionTable(
    "Memories",
    data.memories,
    ["Content", "Importance", "Created"],
    (m) =>
      `<tr><td>${esc(trunc(m.content, 100))}</td>` +
      `<td>${m.importance ?? "--"}</td>` +
      `<td>${fmtDate(m.created_at)}</td></tr>`,
  );

  const relationsHtml = sectionTable(
    "Relations",
    data.relations,
    ["Source", "Relation", "Target"],
    (r) =>
      `<tr><td>${esc(r.source_name)}</td>` +
      `<td><code>${esc(r.relation_type)}</code></td>` +
      `<td>${esc(r.target_name)}</td></tr>`,
  );

  const convosHtml = sectionTable(
    "Conversations",
    data.conversations,
    ["Title", "Created"],
    (c) =>
      `<tr><td>${esc(c.title ?? "(untitled)")}</td>` + `<td>${fmtDate(c.created_at)}</td></tr>`,
  );

  const body = `${header}${statsBar}${entitiesHtml}${memoriesHtml}${relationsHtml}${convosHtml}`;

  return htmlPage(body, {
    title: ns.name,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "API", href: "/api/docs" },
      { label: "Namespaces", href: "/api/v1/namespaces" },
      { label: ns.name },
    ],
  });
}

function sectionTable<T>(
  title: string,
  items: T[],
  headers: string[],
  rowFn: (item: T) => string,
): string {
  if (items.length === 0) {
    return `<div class="card"><h2>${esc(title)}</h2><p class="empty">None</p></div>`;
  }
  const ths = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const rows = items.map(rowFn).join("\n");
  return `<div class="card"><h2>${esc(title)}</h2>
<table><tr>${ths}</tr>${rows}</table></div>`;
}

function trunc(s: string | null | undefined, max: number): string {
  if (!s) return "--";
  return s.length > max ? s.slice(0, max) + "..." : s;
}
