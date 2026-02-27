import fs from "node:fs/promises";

const API_BASE_URL = process.env.API_BASE_URL;
const CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const SEED_FILE = process.env.SEED_FILE ?? "seeds/demo-directions.json";

if (!API_BASE_URL || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing env vars: API_BASE_URL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET");
  process.exit(1);
}

const seed = JSON.parse(await fs.readFile(SEED_FILE, "utf8"));

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "CF-Access-Client-Id": CLIENT_ID,
      "CF-Access-Client-Secret": CLIENT_SECRET,
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

async function seedEntities(namespaceId) {
  const entities = await api(`/api/v1/namespaces/${namespaceId}/entities?limit=200`);
  const byName = new Map(entities.map((e) => [e.name, e.id]));
  const idByKey = new Map();

  for (const entity of seed.entities) {
    let id = byName.get(entity.name);
    if (!id) {
      const created = await api(`/api/v1/namespaces/${namespaceId}/entities`, {
        method: "POST",
        body: JSON.stringify({ name: entity.name, type: entity.type, summary: entity.summary }),
      });
      id = created.id;
      console.log(`+ entity ${entity.name}`);
    }
    idByKey.set(entity.key, id);
  }

  return idByKey;
}

async function seedMemories(namespaceId, idByKey) {
  const memories = await api(`/api/v1/namespaces/${namespaceId}/memories?mode=recall&limit=500`);
  const contentSet = new Set(memories.map((m) => m.content));

  for (const memory of seed.memories) {
    if (contentSet.has(memory.content)) continue;
    const entityIds = memory.entity_keys.map((k) => idByKey.get(k)).filter(Boolean);
    await api(`/api/v1/namespaces/${namespaceId}/memories`, {
      method: "POST",
      body: JSON.stringify({
        content: memory.content,
        type: memory.type,
        entity_ids: entityIds,
      }),
    });
    console.log(`+ memory ${memory.content.slice(0, 48)}...`);
  }
}

const namespaceId = await getOrCreateNamespace();
const idByKey = await seedEntities(namespaceId);
await seedMemories(namespaceId, idByKey);
console.log(`seed complete: namespace=${seed.namespace.name} id=${namespaceId}`);
