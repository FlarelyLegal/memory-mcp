import fs from "node:fs/promises";

const API_BASE_URL = process.env.API_BASE_URL;
const CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const ACCESS_TOKEN = process.env.CF_ACCESS_TOKEN;
const SEED_FILE = process.env.SEED_FILE ?? "seeds/demo-directions.json";

// Support two auth modes: service token (CI) or JWT (manual)
const authHeaders = ACCESS_TOKEN
  ? { "cf-access-token": ACCESS_TOKEN }
  : CLIENT_ID && CLIENT_SECRET
    ? { "CF-Access-Client-Id": CLIENT_ID, "CF-Access-Client-Secret": CLIENT_SECRET }
    : null;

if (!API_BASE_URL || !authHeaders) {
  console.error(
    "Missing env vars. Provide API_BASE_URL and either:\n" +
      "  CF_ACCESS_TOKEN (browser JWT), or\n" +
      "  CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET (service token)",
  );
  process.exit(1);
}

const seed = JSON.parse(await fs.readFile(SEED_FILE, "utf8"));

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${body}`);
  }

  return response.json();
}

// --- Namespace ---

async function getOrCreateNamespace() {
  const namespaces = await api("/api/v1/namespaces");
  const existing = namespaces.find((n) => n.name === seed.namespace.name);
  if (existing) return existing.id;

  const created = await api("/api/v1/namespaces", {
    method: "POST",
    body: JSON.stringify(seed.namespace),
  });
  return created.id;
}

// --- Entities ---

async function seedEntities(namespaceId) {
  const entities = await api(`/api/v1/namespaces/${namespaceId}/entities?limit=200`);
  const byName = new Map(entities.map((e) => [e.name, e.id]));
  const idByKey = new Map();

  for (const entity of seed.entities) {
    let id = byName.get(entity.name);
    if (!id) {
      const body = { name: entity.name, type: entity.type, summary: entity.summary };
      if (entity.metadata) body.metadata = entity.metadata;
      const created = await api(`/api/v1/namespaces/${namespaceId}/entities`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      id = created.id;
      console.log(`+ entity  "${entity.name}" (${entity.type})`);
    } else {
      console.log(`= entity  "${entity.name}" (exists)`);
    }
    idByKey.set(entity.key, id);
  }

  return idByKey;
}

// --- Relations ---

async function seedRelations(namespaceId, idByKey) {
  if (!seed.relations?.length) return;

  // Fetch existing relations to deduplicate
  const existingByTriple = new Set();
  for (const [, entityId] of idByKey) {
    try {
      const rels = await api(`/api/v1/entities/${entityId}/relations?direction=from&limit=50`);
      for (const r of rels) {
        existingByTriple.add(`${r.source_id}|${r.target_id}|${r.relation_type}`);
      }
    } catch {
      // Entity may not have relations endpoint; continue
    }
  }

  for (const rel of seed.relations) {
    const sourceId = idByKey.get(rel.source_key);
    const targetId = idByKey.get(rel.target_key);
    if (!sourceId || !targetId) {
      console.warn(`! relation skipped: missing key ${rel.source_key} or ${rel.target_key}`);
      continue;
    }

    const triple = `${sourceId}|${targetId}|${rel.relation_type}`;
    if (existingByTriple.has(triple)) {
      console.log(
        `= relation ${rel.source_key} -[${rel.relation_type}]-> ${rel.target_key} (exists)`,
      );
      continue;
    }

    const body = {
      source_id: sourceId,
      target_id: targetId,
      relation_type: rel.relation_type,
    };
    if (rel.weight != null) body.weight = rel.weight;
    if (rel.metadata) body.metadata = rel.metadata;

    await api(`/api/v1/namespaces/${namespaceId}/relations`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(`+ relation ${rel.source_key} -[${rel.relation_type}]-> ${rel.target_key}`);
  }
}

// --- Memories ---

async function seedMemories(namespaceId, idByKey) {
  const memories = await api(`/api/v1/namespaces/${namespaceId}/memories?mode=recall&limit=500`);
  const contentSet = new Set(memories.map((m) => m.content));

  for (const memory of seed.memories) {
    if (contentSet.has(memory.content)) {
      console.log(`= memory  "${memory.content.slice(0, 48)}..." (exists)`);
      continue;
    }

    const entityIds = memory.entity_keys.map((k) => idByKey.get(k)).filter(Boolean);
    const body = {
      content: memory.content,
      type: memory.type,
      entity_ids: entityIds,
    };
    if (memory.importance != null) body.importance = memory.importance;
    if (memory.source) body.source = memory.source;
    if (memory.metadata) body.metadata = memory.metadata;

    await api(`/api/v1/namespaces/${namespaceId}/memories`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    console.log(
      `+ memory  "${memory.content.slice(0, 48)}..." (${memory.type}, importance=${memory.importance ?? 0.5})`,
    );
  }
}

// --- Run ---

console.log(`Seeding from ${SEED_FILE} to ${API_BASE_URL}`);
const namespaceId = await getOrCreateNamespace();
console.log(`Namespace: ${seed.namespace.name} (${namespaceId})\n`);

const idByKey = await seedEntities(namespaceId);
console.log("");
await seedRelations(namespaceId, idByKey);
console.log("");
await seedMemories(namespaceId, idByKey);
console.log(`\nSeed complete.`);
