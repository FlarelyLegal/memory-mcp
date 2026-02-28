# Seed Data

[README](../README.md) > [Docs](../docs/README.md) > Seeds

JSON seed files for populating demo namespaces via the REST API.

## Files

| File                   | Description                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo-directions.json` | Self-referential knowledge graph modeling the Memory Graph MCP server itself -- entities, relations, and memories covering architecture, search, auth, and workflows |

## Usage

```bash
# Via service token
API_BASE_URL="https://memory.flarelylegal.com" \
CF_ACCESS_CLIENT_ID="..." CF_ACCESS_CLIENT_SECRET="..." \
node scripts/seed-demo.mjs

# Via browser JWT (copy from CF_Authorization cookie)
API_BASE_URL="https://memory.flarelylegal.com" \
CF_ACCESS_TOKEN="eyJ..." \
node scripts/seed-demo.mjs

# Custom seed file
SEED_FILE="seeds/my-custom.json" API_BASE_URL="..." CF_ACCESS_TOKEN="..." \
node scripts/seed-demo.mjs
```

## Seed file format

```json
{
  "namespace": { "name": "...", "description": "..." },
  "entities": [{ "key": "...", "name": "...", "type": "...", "summary": "..." }],
  "relations": [{ "source_key": "...", "target_key": "...", "relation_type": "..." }],
  "memories": [{ "type": "...", "content": "...", "entity_keys": ["..."] }]
}
```

Entity `key` fields are local references used to resolve `source_key`, `target_key`, and `entity_keys` to real IDs during seeding.
