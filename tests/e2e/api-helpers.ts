import type { APIRequestContext, APIRequest } from "@playwright/test";
import { expect } from "@playwright/test";

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

export type E2eCleanup = {
  entities: string[];
  relations: string[];
  memories: string[];
};

export async function createApiContext(request: APIRequest): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: {
      "CF-Access-Client-Id": clientId,
      "CF-Access-Client-Secret": clientSecret,
    },
  });
}

export async function ensureNamespace(
  api: APIRequestContext,
  namespaceName: string,
): Promise<string> {
  const res = await api.get("/api/v1/namespaces");
  expect(res.ok()).toBe(true);
  const namespaces = await res.json();
  let ns = namespaces.find((n: { name: string }) => n.name === namespaceName);
  if (!ns) {
    const created = await api.post("/api/v1/namespaces", {
      data: { name: namespaceName, description: "Shared namespace for API E2E tests" },
    });
    expect(created.ok()).toBe(true);
    ns = await created.json();
  }
  return ns.id;
}

export async function cleanupArtifacts(api: APIRequestContext, cleanup: E2eCleanup): Promise<void> {
  for (const id of cleanup.relations) {
    await api.delete(`/api/v1/relations/${id}`);
  }
  for (const id of cleanup.memories) {
    await api.delete(`/api/v1/memories/${id}`);
  }
  for (const id of cleanup.entities) {
    await api.delete(`/api/v1/entities/${id}`);
  }
}
