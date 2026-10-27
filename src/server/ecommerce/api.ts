import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createEcommerce } from "./service";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function payload(request: Request, fields: string[]) {
  const text = await request.text();
  if (text.length > 16384) throw new TenantError(413, "payload_too_large");
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !fields.includes(k))) throw new TenantError(400, "invalid_payload");
  return data as Record<string, unknown>;
}
export async function handleEcommerce(request: Request): Promise<Response> {
  const requestId = randomUUID(); const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    if (request.method !== "GET" && (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))) throw new TenantError(403, "invalid_origin");
    const path = new URL(request.url).pathname.replace(/^\/api\/ecommerce\/?/, "").split("/").filter(Boolean);
    if (path.length < 1 || path.length > 3 || !uuid(path[0]) || (path[2] && !uuid(path[2]))) throw new TenantError(404, "not_found");
    const [tenantId, resource, id] = path; const service = createEcommerce(getDatabase()); let result: unknown; let status = 200;
    const url = new URL(request.url); const limit = Number(url.searchParams.get("limit") ?? 20); const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
    if (resource === "store" && !id && request.method === "GET") result = await service.store(session.user, tenantId);
    else if (resource === "store" && !id && request.method === "POST") {
      const data = await payload(request, ["name", "slug", "currency"]);
      if (typeof data.name !== "string" || typeof data.slug !== "string" || typeof data.currency !== "string") throw new TenantError(400, "invalid_payload");
      result = await service.createStore(session.user, tenantId, data as { name: string; slug: string; currency: string }, requestId); status = 201;
    } else if (resource === "store" && !id && request.method === "PATCH") {
      const data = await payload(request, ["name", "currency", "isActive", "version"]);
      if (typeof data.name !== "string" || typeof data.currency !== "string" || typeof data.isActive !== "boolean" || typeof data.version !== "number") throw new TenantError(400, "invalid_payload");
      result = await service.updateStore(session.user, tenantId, data as { name: string; currency: string; isActive: boolean; version: number }, requestId);
    } else if (resource === "products" && !id && request.method === "GET") result = await service.products(session.user, tenantId, limit, offset);
    else if (resource === "products" && id && request.method === "GET") result = await service.product(session.user, tenantId, id);
    else if (resource === "products" && !id && request.method === "POST" || resource === "products" && id && request.method === "PATCH") {
      const fields = ["code", "name", "description", "price", "isPublished", ...(id ? ["version"] : [])]; const data = await payload(request, fields);
      if (typeof data.code !== "string" || typeof data.name !== "string" || typeof data.description !== "string" || typeof data.price !== "string" || typeof data.isPublished !== "boolean" || (id && typeof data.version !== "number")) throw new TenantError(400, "invalid_payload");
      const input = { code: data.code, name: data.name, description: data.description, price: data.price, isPublished: data.isPublished };
      if (id) result = await service.updateProduct(session.user, tenantId, id, input, data.version as number, requestId);
      else { result = await service.createProduct(session.user, tenantId, input, requestId); status = 201; }
    } else throw new TenantError(405, "method_not_allowed");
    console.info(JSON.stringify({ event: "ecommerce.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : duplicate ? 409 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : duplicate ? "already_exists" : "service_unavailable";
    console.warn(JSON.stringify({ event: "ecommerce.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
