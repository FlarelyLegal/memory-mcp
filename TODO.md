# TODO

Remaining improvements for memory-graph-mcp.

---

## Infra (post-deploy)

- [ ] Run `reindex_vectors` on all namespaces (re-embed with bge-m3 + populate new metadata)
- [ ] Evaluate bge-m3's built-in reranking mode vs separate bge-reranker-base

---

## Future ideas

- Memory merging: cluster related memories via vector similarity, LLM summarize into one
