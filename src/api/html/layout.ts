/**
 * Shared HTML layout shell for browser views.
 *
 * Design standard: Inter font, light gray background (#f5f5f5), white cards
 * with 1px #e0e0e0 border and 8px radius, blue primary (#0070f3).
 * Matches the bind UI page in bind-ui-html.ts.
 */
import { VERSION, REPO_URL } from "../../version.js";

/** Escape HTML special characters. */
export function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format a Unix timestamp or ISO string as a short date. */
export function fmtDate(v: string | number | null | undefined): string {
  if (!v) return "--";
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return d.toISOString().slice(0, 10);
}

export interface LayoutOptions {
  title: string;
  /** Breadcrumb segments: [{label, href}]. Last segment has no href (current page). */
  breadcrumbs?: { label: string; href?: string }[];
  /** Extra CSS appended after base styles. */
  extraCss?: string;
  /** Inline script body. */
  script?: string;
  /** CSP nonce for the script tag. If omitted, uses 'unsafe-inline'. */
  scriptNonce?: string;
  /** Override max-width of .wrap container (default 900px). */
  maxWidth?: string;
  /** Cache-Control header (default "no-store"). */
  cacheControl?: string;
}

/** Wrap body content in the shared HTML shell. Returns a Response. */
export function htmlPage(body: string, opts: LayoutOptions): Response {
  const crumbs = opts.breadcrumbs ?? [];
  const breadcrumbHtml = crumbs.length
    ? `<nav class="crumbs">${crumbs
        .map((c, i) =>
          i < crumbs.length - 1
            ? `<a href="${esc(c.href)}">${esc(c.label)}</a><span class="sep">/</span>`
            : `<span class="current">${esc(c.label)}</span>`,
        )
        .join("")}</nav>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<title>${esc(opts.title)} -- Memory MCP</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;color:#1a1a1a;background:#f5f5f5;padding:2rem 1rem;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:${opts.maxWidth ?? "900px"};margin:0 auto}
header{margin-bottom:1.5rem}
header h1{font-size:20px;font-weight:600;margin-bottom:.25rem}
header p{color:#666;font-size:13px}
.crumbs{font-size:13px;color:#666;margin-bottom:1rem}
.crumbs a{color:#0070f3;text-decoration:none}
.crumbs a:hover{text-decoration:underline}
.crumbs .sep{margin:0 .35rem;color:#ccc}
.crumbs .current{color:#1a1a1a;font-weight:500}
.card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:1.25rem;margin-bottom:1rem}
.card h2{font-size:14px;font-weight:600;margin-bottom:.75rem}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;margin-bottom:1rem}
.card-grid .card{margin-bottom:0;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.card-grid .card:hover{border-color:#0070f3;box-shadow:0 2px 8px rgba(0,112,243,.1)}
.card-grid .card a{text-decoration:none;color:inherit;display:block}
.card-title{font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:.35rem}
.card-meta{font-size:12px;color:#888;margin-bottom:.5rem}
.badge{display:inline-block;font-size:11px;font-weight:500;padding:.1rem .4rem;border-radius:3px;margin-left:.35rem;vertical-align:middle}
.badge-public{background:#dbeafe;color:#1e40af}
.badge-private{background:#f3f4f6;color:#6b7280}
.stats{display:flex;gap:1rem;flex-wrap:wrap}
.stat{font-size:12px;color:#666}
.stat strong{color:#1a1a1a;font-weight:600}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.5rem;font-size:13px}
th{color:#666;font-weight:500;border-bottom:1px solid #e0e0e0}
td{border-bottom:1px solid #f0f0f0}
td a{color:#0070f3;text-decoration:none}
td a:hover{text-decoration:underline}
code{font-family:ui-monospace,monospace;font-size:12px;background:#f5f5f5;padding:.1rem .3rem;border-radius:3px}
.empty{color:#888;font-size:13px;padding:.5rem 0}
footer{text-align:center;margin-top:1.5rem}
.footer-link{color:#999;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.footer-link:hover{color:#666}
.version{color:#999;font-size:11px;margin-top:.35rem}
${opts.extraCss ?? ""}
</style>
</head>
<body>
<div class="wrap">
${breadcrumbHtml}
${body}
<footer>
<a href="${REPO_URL}" class="footer-link">Memory MCP</a>
<div class="version">v${VERSION}</div>
</footer>
</div>
${opts.script ? `<script${opts.scriptNonce ? ` nonce="${esc(opts.scriptNonce)}"` : ""}>${opts.script}</script>` : ""}
</body>
</html>`;

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    opts.script
      ? opts.scriptNonce
        ? `script-src 'nonce-${opts.scriptNonce}'`
        : "script-src 'unsafe-inline'"
      : "",
    "connect-src 'self'",
  ]
    .filter(Boolean)
    .join("; ");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cache-Control": opts.cacheControl ?? "no-store",
    },
  });
}
