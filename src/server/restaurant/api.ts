import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createRestaurant } from "./service";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function payload(request: Request, fields: string[]) {
  const text = await request.text(); if (text.length > 16384) throw new TenantError(413, "payload_too_large");
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !fields.includes(key))) throw new TenantError(400, "invalid_payload");
  return data as Record<string, unknown>;
}
const methodFor = (method: string, allow: string) => allow.split("|").includes(method);

export async function handleRestaurant(request: Request): Promise<Response> {
  const requestId = randomUUID(), headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    const url = new URL(request.url), parts = url.pathname.replace(/^\/api\/restaurant\/?/, "").split("/").filter(Boolean);
    const publicRoute = parts[0] === "public";
    if (request.method !== "GET" && (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))) throw new TenantError(403, "invalid_origin");
    const service = createRestaurant(getDatabase(), readAuthConfig().baseURL);
    if (publicRoute) {
      if (parts.length < 2 || parts.length > 3) throw new TenantError(404, "not_found");
      const token = parts[1];
      if (request.method === "GET" && parts.length === 2) return Response.json(await service.publicMenu(token), { headers });
      if (request.method === "POST" && parts[2] === "orders") {
        const data = await payload(request, ["lines"]), key = request.headers.get("idempotency-key");
        if (typeof key !== "string" || !Array.isArray(data.lines)) throw new TenantError(400, "invalid_order");
        const lines = data.lines.map(value => {
          if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(field => field !== "itemId" && field !== "quantity")) throw new TenantError(400, "invalid_order");
          return value as { itemId: string; quantity: number };
        });
        const result = await service.submitPublicOrder(token, key, lines, requestId); return Response.json(result, { status: 201, headers });
      }
      throw new TenantError(405, "method_not_allowed");
    }
    if (parts.length < 2 || !uuid(parts[0])) throw new TenantError(404, "not_found");
    const [tenantId, resource, id, action] = parts, auth = await getAuth().api.getSession({ headers: request.headers });
    if (!auth?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    const actor = auth.user;
    let result: unknown, status = 200;
    const dataByMethod = request.method === "POST" || request.method === "PATCH" ? await payload(request, resource === "restaurant" ? ["name", "currency", "isActive", "version"] : resource === "categories" ? ["name", "sortOrder", "isActive", "version"] : resource === "items" ? ["categoryId", "code", "name", "description", "price", "isPublished", "version"] : resource === "tables" ? action === "qr" ? [] : ["tableNumber", "label", "isActive", "version"] : resource === "orders" ? ["status"] : []) : {};
    if (resource === "restaurant" && !id && request.method === "GET") result = await service.getSetup(actor, tenantId);
    else if (resource === "restaurant" && !id && methodFor(request.method, "POST|PATCH")) { result = await service.saveSetup(actor, tenantId, dataByMethod as never, requestId); status = request.method === "POST" ? 201 : 200; }
    else if (resource === "categories" && !id && request.method === "GET") result = await service.categories(actor, tenantId);
    else if (resource === "categories" && methodFor(request.method, "POST|PATCH")) { result = await service.saveCategory(actor, tenantId, id ?? null, dataByMethod as never, requestId); status = request.method === "POST" ? 201 : 200; }
    else if (resource === "items" && !id && request.method === "GET") result = await service.items(actor, tenantId);
    else if (resource === "items" && methodFor(request.method, "POST|PATCH")) { result = await service.saveItem(actor, tenantId, id ?? null, dataByMethod as never, requestId); status = request.method === "POST" ? 201 : 200; }
    else if (resource === "tables" && !id && request.method === "GET") result = await service.tables(actor, tenantId);
    else if (resource === "tables" && !id && request.method === "POST") { result = await service.createTable(actor, tenantId, dataByMethod as never, requestId); status = 201; }
    else if (resource === "tables" && id && action === "qr" && request.method === "POST") result = await service.rotateTableQr(actor, tenantId, id, requestId);
    else if (resource === "tables" && id && !action && request.method === "PATCH") result = await service.updateTable(actor, tenantId, id, dataByMethod as never, requestId);
    else if (resource === "orders" && !id && request.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 50), offset = Number(url.searchParams.get("offset") ?? 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
      result = await service.orders(actor, tenantId, limit, offset);
    }
    else if (resource === "orders" && id && action === "status" && request.method === "POST" && typeof dataByMethod.status === "string") result = await service.transitionOrder(actor, tenantId, id, dataByMethod.status, requestId);
    else throw new TenantError(405, "method_not_allowed");
    console.info(JSON.stringify({ event: "restaurant.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers });
  } catch (error) {
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    console.warn(JSON.stringify({ event: "restaurant.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
