import { test, expect, type APIRequestContext } from "@playwright/test";

const NAMESPACE_NAME = "Playwright Testing";
let api: APIRequestContext;
let namespaceId: string;

const target = (process.env.API_TARGET ?? "a").toLowerCase();
const isB = target === "b";

const baseURL =
  (isB ? process.env.API_BASE_URL_B : process.env.API_BASE_URL_A) ??
  process.env.API_BASE_URL ??
  "https://memory.schenanigans.com";

const clientId =
  (isB ? process.env.CF_ACCESS_CLIENT_ID_B : process.env.CF_ACCESS_CLIENT_ID_A) ??
  process.env.CF_ACCESS_CLIENT_ID ??
  "";

const clientSecret =
  (isB ? process.env.CF_ACCESS_CLIENT_SECRET_B : process.env.CF_ACCESS_CLIENT_SECRET_A) ??
  process.env.CF_ACCESS_CLIENT_SECRET ??
  "";

const cleanup = { entities: [] as string[], relations: [] as string[], memories: [] as string[] };

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      "CF-Access-Client-Id": clientId,
      "CF-Access-Client-Secret": clientSecret,
    },
  });

  // Resolve the Playwright Testing namespace ID
  const res = await api.get("/api/v1/namespaces");
  expect(res.ok()).toBe(true);
  const namespaces = await res.json();
  let ns = namespaces.find((n: { name: string }) => n.name === NAMESPACE_NAME);
  if (!ns) {
    const created = await api.post("/api/v1/namespaces", {
      data: { name: NAMESPACE_NAME, description: "Shared namespace for API E2E tests" },
    });
    expect(created.ok()).toBe(true);
    ns = await created.json();
  }
  namespaceId = ns.id;
});

test.afterAll(async () => {
  for (const id of cleanup.relations) {
    await api.delete(`/api/v1/relations/${id}`);
  }
  for (const id of cleanup.memories) {
    await api.delete(`/api/v1/memories/${id}`);
  }
  for (const id of cleanup.entities) {
    await api.delete(`/api/v1/entities/${id}`);
  }
  await api.dispose();
});

// ── Public endpoints ───────────────────────────────────────────────

test.describe("public endpoints", () => {
  test("GET /health returns ok", async () => {
    const res = await api.get("/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", server: "memory-graph-mcp" });
    expect(body.version).toBeTruthy();
  });

  test("GET /api/openapi.json returns valid spec", async () => {
    const res = await api.get("/api/openapi.json");
    expect(res.ok()).toBe(true);
    const spec = await res.json();
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.paths).toBeTruthy();
  });
});

// ── Entity CRUD ───────────────────────────────────��────────────────

test.describe("entity CRUD", () => {
  let entityId: string;

  test("create entity", async () => {
    const res = await api.post(`/api/v1/namespaces/${namespaceId}/entities`, {
      data: { name: "pw-test-entity", type: "test", summary: "Playwright test entity" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("pw-test-entity");
    expect(body.type).toBe("test");
    entityId = body.id;
    cleanup.entities.push(entityId);
  });

  test("get entity", async () => {
    const res = await api.get(`/api/v1/entities/${entityId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.name).toBe("pw-test-entity");
  });

  test("list entities", async () => {
    const res = await api.get(`/api/v1/namespaces/${namespaceId}/entities`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((e: { id: string }) => e.id === entityId)).toBe(true);
  });

  test("update entity", async () => {
    const res = await api.put(`/api/v1/entities/${entityId}`, {
      data: { summary: "Updated by Playwright" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ── Relations ──────────────────────────────────────────────────────

test.describe("relations", () => {
  let sourceId: string;
  let targetId: string;
  let relationId: string;

  test.beforeAll(async () => {
    const src = await api.post(`/api/v1/namespaces/${namespaceId}/entities`, {
      data: { name: "pw-rel-source", type: "test" },
    });
    expect(src.ok()).toBe(true);
    sourceId = (await src.json()).id;
    cleanup.entities.push(sourceId);

    const tgt = await api.post(`/api/v1/namespaces/${namespaceId}/entities`, {
      data: { name: "pw-rel-target", type: "test" },
    });
    expect(tgt.ok()).toBe(true);
    targetId = (await tgt.json()).id;
    cleanup.entities.push(targetId);
  });

  test("create relation", async () => {
    const res = await api.post(`/api/v1/namespaces/${namespaceId}/relations`, {
      data: { source_id: sourceId, target_id: targetId, relation_type: "tests_with" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    relationId = body.id;
    cleanup.relations.push(relationId);
  });

  test("get relations for entity", async () => {
    const res = await api.get(`/api/v1/entities/${sourceId}/relations`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.some((r: { id: string }) => r.id === relationId)).toBe(true);
  });

  test("traverse graph", async () => {
    const res = await api.get(`/api/v1/entities/${sourceId}/traverse?max_depth=2`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.entities)).toBe(true);
    expect(Array.isArray(body.relations)).toBe(true);
    expect(body.relations.some((r: { target_id: string }) => r.target_id === targetId)).toBe(true);
  });
});

// ── Memory CRUD ────────────────────────────────────────────────────

test.describe("memory CRUD", () => {
  let memoryId: string;

  test("create memory", async () => {
    const res = await api.post(`/api/v1/namespaces/${namespaceId}/memories`, {
      data: { content: "Playwright E2E test memory", type: "fact" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    memoryId = body.id;
    cleanup.memories.push(memoryId);
  });

  test("get memory", async () => {
    const res = await api.get(`/api/v1/memories/${memoryId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.content).toContain("Playwright");
  });

  test("query memories", async () => {
    const res = await api.get(
      `/api/v1/namespaces/${namespaceId}/memories?mode=search&q=playwright`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("update memory", async () => {
    const res = await api.put(`/api/v1/memories/${memoryId}`, {
      data: { content: "Updated by Playwright E2E" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ── Conversations & Messages ───────────────────────────────────────

test.describe("conversations", () => {
  let conversationId: string;

  test("create conversation", async () => {
    const res = await api.post(`/api/v1/namespaces/${namespaceId}/conversations`, {
      data: { title: "Playwright test conversation" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    conversationId = body.id;
  });

  test("list conversations", async () => {
    const res = await api.get(`/api/v1/namespaces/${namespaceId}/conversations`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.some((c: { id: string }) => c.id === conversationId)).toBe(true);
  });

  test("add message", async () => {
    const res = await api.post(`/api/v1/conversations/${conversationId}/messages`, {
      data: { role: "user", content: "Hello from Playwright" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBeTruthy();
  });

  test("get messages", async () => {
    const res = await api.get(`/api/v1/conversations/${conversationId}/messages`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].content).toBe("Hello from Playwright");
  });
});

// ── Error handling ─────────────────────────────────────────────────

test.describe("error handling", () => {
  test("non-existent entity returns 403", async () => {
    const res = await api.get("/api/v1/entities/00000000-0000-0000-0000-000000000000");
    expect(res.status()).toBe(403);
  });

  test("unknown route returns 404", async () => {
    const res = await api.get("/api/v1/nonexistent");
    expect(res.status()).toBe(404);
  });
});
