# TODO

Remaining improvements for memory-graph-mcp.

---

## Infra (post-deploy)

- [ ] Deploy to both accounts
- [ ] Enable D1 read replication (both accounts, dashboard)
- [ ] Run `vectorize:indexes` + `vectorize:indexes:b` to create new metadata indexes
- [ ] Run `reindex_vectors` on all namespaces (re-embed with bge-m3 + populate new metadata)
- [ ] Evaluate bge-m3's built-in reranking mode vs separate bge-reranker-base

---

## 9. D1 Write Retry Logic

**Impact:** Low-Medium — resilience for transient D1 errors on writes.

- [ ] Add `@cloudflare/actors` dependency (or copy `tryWhile` pattern)
- [ ] Create `src/db.ts` retry helper: `retryWrite(fn)` with exponential backoff
- [ ] Retryable errors: `"Network connection lost"`, `"storage caused object to be reset"`, `"reset because its code was updated"`
- [ ] Max 5 retries with jitter
- [ ] Wrap all write operations: `createEntity`, `updateEntity`, `deleteEntity`, `createRelation`, `createMemory`, `addMessage`, etc.
- [ ] Log retries for observability

---

## Future ideas

- Memory merging: cluster related memories via vector similarity, LLM summarize into one
