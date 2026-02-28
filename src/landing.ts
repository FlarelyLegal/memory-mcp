/** Landing page renderer for GET /. */
import { VERSION, REPO_URL } from "./version.js";

/** Render the root landing page as HTML. */
export function renderLandingPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <title>Memory MCP Server</title>
  <style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;color:#1a1a1a;background:#f5f5f5;padding:2rem 1rem;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:560px;margin:0 auto}
header{text-align:center;margin-bottom:2rem}
header h1{font-size:20px;font-weight:600;margin-bottom:.25rem}
.card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:1.5rem;margin-bottom:1.5rem}
.card h2{font-size:14px;font-weight:600;margin-bottom:.75rem}
.card p{color:#444;font-size:14px;line-height:1.6}
.links{list-style:none;padding:0}
.links li{padding:.5rem 0;border-bottom:1px solid #f0f0f0}
.links li:last-child{border-bottom:none}
.links a{color:#0070f3;text-decoration:none;font-weight:500}
.links a:hover{text-decoration:underline}
.links .desc{color:#888;font-size:12px;margin-left:.5rem}
.status{display:inline-block;padding:.15rem .5rem;border-radius:12px;font-size:12px;font-weight:500}
.status.ok{background:#f0fdf4;color:#166534}
.status.err{background:#fef2f2;color:#991b1b}
.status.loading{background:#f5f5f5;color:#888}
footer{text-align:center;margin-top:1rem}
.footer-link{color:#999;font-size:12px;text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.footer-link:hover{color:#666}
.footer-link svg{vertical-align:middle}
.version{color:#999;font-size:11px;margin-top:.35rem}
  </style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Memory MCP Server</h1>
    <span class="status loading" id="st">checking...</span>
  </header>

  <div class="card">
    <h2>About</h2>
    <p>AI agents start every conversation from scratch. The context your team builds up across sessions, projects, and people disappears the moment a session ends.</p>
    <p style="margin-top:.75rem">Memory Graph MCP changes that. Your agents build a living knowledge graph that persists across conversations and can be shared across your team. Every user gets their own private space by default. When you are ready to collaborate, open a namespace to specific people or groups with role-based access control. A full REST API with OpenAPI 3.1 means the same memory is accessible from any HTTP client: internal tools, CI/CD pipelines, dashboards, or custom integrations can read and write knowledge alongside your agents. Give a CI/CD pipeline editor access to push deployment context. Grant a third-party integration read-only access to query your knowledge graph. Share a namespace with your entire team through a group.</p>
    <p style="margin-top:.75rem">Agents store knowledge as structured graphs, freeform memories, and conversation history. Semantic search finds relevant context by meaning. Temporal decay ensures recent and important information surfaces first. Every mutation is tracked in an audit trail that records who changed what and when, without logging content or payloads. Audit logs are archived to R2 as NDJSON, ready for ingestion by Loki, Splunk, Datadog, Elastic, or any S3-compatible log aggregator.</p>
    <p style="margin-top:.75rem">Built entirely on the Cloudflare developer platform: Workers for compute, D1 for structured data, Vectorize and Workers AI for semantic search and embeddings, KV for identity caching, R2 for audit archival, Durable Objects for stateful sessions, Workflows for background maintenance, and Cloudflare Access for authentication. Deployed at the edge, globally distributed, with nothing to provision or manage.</p>
  </div>

  <div class="card">
    <h2>Quick links</h2>
    <ul class="links">
      <li>
        <a href="/api/docs">API Documentation</a>
        <span class="desc">Interactive OpenAPI reference</span>
      </li>
      <li>
        <a href="/api/v1/admin/service-tokens/bind">Service Token Management</a>
        <span class="desc">Bind and manage service tokens</span>
      </li>

    </ul>
  </div>

  <footer>
    <a href="${REPO_URL}" class="footer-link">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Memory MCP Server
    </a>
    <div class="version">v${VERSION}</div>
  </footer>
</div>

<script>
(function(){
  var el=document.getElementById('st');
  fetch('/health').then(function(r){return r.json()}).then(function(d){
    if(d&&d.status==='ok'){el.textContent='online';el.className='status ok'}
    else{el.textContent='degraded';el.className='status err'}
  }).catch(function(){el.textContent='unreachable';el.className='status err'});
})();
</script>
</body>
</html>`;

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "connect-src 'self'",
  ].join("; ");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cache-Control": "public, max-age=300",
    },
  });
}
