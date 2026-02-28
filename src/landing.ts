/** Landing page renderer for GET /. */
import { htmlPage } from "./api/html/layout.js";

const EXTRA_CSS = `
header{text-align:center;margin-bottom:2rem}
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
`;

const HEALTH_SCRIPT = `(function(){
var el=document.getElementById('st');
fetch('/health').then(function(r){return r.json()}).then(function(d){
if(d&&d.status==='ok'){el.textContent='online';el.className='status ok'}
else{el.textContent='degraded';el.className='status err'}
}).catch(function(){el.textContent='unreachable';el.className='status err'});
})();`;

const BODY = `<header>
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
<li><a href="/api/docs">API Documentation</a><span class="desc">Interactive OpenAPI reference</span></li>
<li><a href="/api/v1/admin/service-tokens/bind">Service Token Management</a><span class="desc">Bind and manage service tokens</span></li>
</ul>
</div>`;

/** Render the root landing page as HTML. */
export function renderLandingPage(): Response {
  return htmlPage(BODY, {
    title: "Memory MCP Server",
    maxWidth: "560px",
    cacheControl: "public, max-age=300",
    extraCss: EXTRA_CSS,
    script: HEALTH_SCRIPT,
  });
}
