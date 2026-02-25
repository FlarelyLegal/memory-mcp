# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Dependencies
- **deps:** Bump agents from 0.1.6 to 0.6.0 (#1) ([#1](https://github.com/FlarelyLegal/memory-mcp/pull/1)) by @dependabot[bot]
- **deps:** Bump zod from 3.25.76 to 4.3.6 (#2) ([#2](https://github.com/FlarelyLegal/memory-mcp/pull/2)) by @dependabot[bot]

### Other
- Initial memory-graph-mcp: MCP server on Cloudflare Workers providing LLMs with persistent structured memory (entity graphs, semantic search, conversation history, temporal decay) by @Cloudflare-Tim
- Add GitHub Actions CI/CD workflows, dependabot config, and PR automation by @Cloudflare-Tim
- Configure actual Cloudflare resource IDs (D1, KV, Vectorize, R2) by @Cloudflare-Tim
- Fix health endpoint, update compat date to 2026-02-25, fix DO binding name by @Cloudflare-Tim
- Add reindex_vectors tool to re-embed all entities and memories into Vectorize by @Cloudflare-Tim
- Add Cloudflare Access OAuth authentication by @Cloudflare-Tim
- Add per-user namespace authorization by @Cloudflare-Tim
- Fix README: correct tool count, architecture table, resource names; add badges by @Cloudflare-Tim
- Fix tool count: 25 not 23 (actual count from src/index.ts) by @cursoragent
- Upgrade embedding model to bge-large-en-v1.5 (1024d), fix SDK mismatch, add AGENTS.md by @Cloudflare-Tim
- Fix README accuracy (#3) ([#3](https://github.com/FlarelyLegal/memory-mcp/pull/3)) by @taslabs-net
- Add ESLint 10 and Prettier, wire into CI by @Cloudflare-Tim
- Add ESLint 10 and Prettier, wire into CI (#5) ([#5](https://github.com/FlarelyLegal/memory-mcp/pull/5)) by @taslabs-net
- Split oversized files into focused modules (250-line cap) by @Cloudflare-Tim
- Split oversized files into focused modules (250-line cap) (#8) ([#8](https://github.com/FlarelyLegal/memory-mcp/pull/8)) by @taslabs-net

