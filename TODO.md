# TODO

Remaining improvements for memory-graph-mcp.

---

## Namespace visibility (public read, admin write)

- [ ] Schema: add `visibility` column to namespaces (`private` | `public`, default `private`)
- [ ] Types: add `visibility` to `NamespaceRow` + `Namespace`
- [ ] Auth: `assertNamespaceReadAccess` — allows if owner OR `visibility = 'public'`
- [ ] Namespace listing: include public namespaces alongside owned
- [ ] MCP tools: read ops (get, find, search, traverse, query, messages) use read-access check
- [ ] REST routes: GET endpoints use read-access check
- [ ] Admin: `set_visibility` action on `manage_namespace` + `PATCH /api/v1/namespaces/:id`
- [ ] Admins can write to public namespaces they don't own
- [ ] Docs: update AGENTS.md, docs/, README roadmap
- [ ] Deploy: migrate existing DBs, set demo namespace to `public`

---

## Infra (post-deploy)

- [ ] Run `reindex_vectors` on all namespaces (re-embed with bge-m3 + populate new metadata)
- [ ] Evaluate bge-m3's built-in reranking mode vs separate bge-reranker-base
- [ ] Wire up `RATE_LIMIT_AUTH` and `RATE_LIMIT_SEARCH` bindings
- [ ] Populate `cors:origins` KV key per deployment for cross-origin browser clients
- [ ] Audit query MCP tool + REST API routes (code exists, no endpoints yet)

---

## Future ideas

- Memory merging: cluster related memories via vector similarity, LLM summarize into one
- Field-level encryption for sensitive D1 data
- Namespace groups: shared write access across multiple users
- Health check config validation (`/health` verifies KV keys)
