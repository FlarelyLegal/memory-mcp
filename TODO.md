# Roadmap — v0.11.0+

Tracked improvements for memory-graph-mcp. Cross off as completed.

---

## 1. ~~D1 Read Replication (Sessions API)~~ DONE

**Impact:** High — read-heavy server gets global latency reduction at zero cost.

- [x] Create `src/db.ts` helper: `DbHandle` type + `session()` + `getBookmark()`
- [x] Refactor all graph modules to accept `DbHandle` (33 functions)
- [x] Refactor `memories.ts`, `conversations.ts`, `auth.ts`, `reranker.ts` to accept `DbHandle`
- [x] Read-only MCP tools use `session(env.DB, "first-unconstrained")`
- [x] Write MCP tools use `session(env.DB, "first-primary")`
- [x] API router creates sessions per-request, injects `ctx.db` into `ApiContext`
- [x] API accepts `X-D1-Bookmark` header for cross-request consistency
- [x] API returns `X-D1-Bookmark` header in responses
- [ ] Enable read replication on D1 databases (both accounts, dashboard)
- [ ] Verify with `meta.served_by_region` in logs

---

## 2. Maximize Vectorize Metadata Indexes

**Impact:** Medium — enable filtered semantic search without post-filtering. 7 of 10 indexes unused.

- [ ] Audit current metadata stored per vector (namespace_id, kind, type)
- [ ] Add `entity_type` metadata on entity vectors (person, concept, project, etc.)
- [ ] Add `memory_type` metadata on memory vectors (fact, observation, preference, instruction)
- [ ] Add `created_at` (epoch) metadata for time-bounded search
- [ ] Register new metadata indexes via `vectorize:indexes` scripts
- [ ] Update `search` tool + API route to accept `entity_type`, `memory_type`, `after`/`before` filters
- [ ] Update `reindex_vectors` to include new metadata fields
- [ ] Document new filter params in tool descriptions

---

## 3. Upgrade to bge-m3 Embedding Model

**Impact:** High — 16x cheaper ($0.012 vs $0.20/M tokens), 100+ languages, 60K token context, same 1024 dims (drop-in).

- [ ] Verify bge-m3 produces 1024-dim vectors (confirmed in research)
- [ ] Update `EMBEDDING_MODEL` constant in `src/embeddings.ts`
- [ ] Test embedding generation locally (Workers AI not available locally — test on remote)
- [ ] Deploy to both accounts
- [ ] Run `reindex_vectors` on all namespaces (both accounts) to re-embed existing content
- [ ] Evaluate bge-m3's built-in reranking mode as potential replacement for separate bge-reranker-base call
- [ ] Update README/AGENTS.md model reference

---

## 5. Per-Session State (`this.state` / `this.setState()`)

**Impact:** Medium — smarter tools with session context, no extra params needed.

- [ ] Define `State` type: `{ currentNamespace?: string, recentEntities?: string[], recentConversation?: string }`
- [ ] Set `initialState` on `MemoryGraphMCP` McpAgent class
- [ ] Auto-track current namespace when tools reference one
- [ ] Auto-track recently accessed entity IDs (last 10)
- [ ] Auto-track current conversation ID
- [ ] Tools can use state as defaults when params are omitted (e.g., `namespace_id` defaults to last-used)
- [ ] Expose `get_session_context` tool or include in tool descriptions

---

## 6. Elicitation (Human-in-the-Loop Confirmation)

**Impact:** Medium — safety on destructive operations. Uses `this.server.server.elicitInput()`.

- [ ] Add elicitation to `manage_entity` delete action: "Delete entity {name} and all its relations?"
- [ ] Add elicitation to `manage_relation` delete action (if entity has many relations)
- [ ] Add elicitation to `claim_namespaces`: "Claim {n} unowned namespaces?"
- [ ] Add elicitation to `reindex_vectors` with namespace_id="all": "Re-embed all entities and memories?"
- [ ] Handle `decline` action gracefully → return `err("Cancelled")`
- [ ] Guard with feature flag or capability check (not all MCP clients support elicitation)
- [ ] Pass `extra.requestId` through `toolHandler` wrapper

---

## 7. Workflows for Batch Reindex

**Impact:** Medium — reliable large-scale reindex with automatic retries, no CPU limits.

- [ ] Create `src/workflows/reindex.ts` extending `WorkflowEntrypoint`
- [ ] Define steps: fetch entities → chunk at 25 → embed each chunk → fetch memories → chunk → embed
- [ ] Each `step.do()` has retry config (limit: 3, backoff: exponential)
- [ ] Add `REINDEX_WORKFLOW` binding in both wrangler configs
- [ ] Trigger from `reindex_vectors` MCP tool (start workflow, return instance ID)
- [ ] Trigger from `POST /api/v1/admin/reindex` route
- [ ] Add `GET /api/v1/admin/reindex/:instanceId` to check workflow status
- [ ] Use `AgentWorkflow` if beneficial for progress reporting back to MCP session

---

## 8. Memory Consolidation

**Impact:** Medium-High — reduces noise, surfaces important patterns, keeps memory sharp over time.

Ideas:

- [ ] **Periodic decay sweep:** Workflow that runs daily/weekly, soft-deletes memories below a decay threshold
- [ ] **Memory merging:** Use Workers AI LLM to summarize clusters of related memories into a single consolidated memory
- [ ] **Entity summary refresh:** Periodically re-summarize entities based on their linked memories (auto-update entity.summary)
- [ ] **Duplicate detection:** FTS5 + vector similarity to find near-duplicate memories, prompt for merge
- [ ] **Archive tier:** Move old low-importance memories to R2 as JSON, keep index in D1 for search but mark as archived
- [ ] **Stats endpoint:** `GET /api/v1/admin/stats` �� memory count by type, avg importance, decay distribution, namespace sizes

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

## Not Doing

- **Code mode / code execution sandbox:** No native Cloudflare support. The Anthropic blog describes a client-side pattern where agents write code to call MCP tools instead of calling them directly. This is a client concern (e.g., Claude Code already does this), not a server feature. Our server already works optimally with code-mode clients — tool schemas are well-typed with Zod, responses are structured JSON.
- **AI Search integration:** Too high-level for structured knowledge graphs. Our FTS5 + Vectorize + reranker pipeline gives more control.
- **DO SQLite session caching:** Premature — D1 read replicas solve the latency problem more cleanly.
- **Data jurisdiction (`jurisdiction: "eu"`):** One-line config change, do it when there's a customer need.
