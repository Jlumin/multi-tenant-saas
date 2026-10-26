import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createWms, type WmsScope } from "./service";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function payload(request: Request, fields: string[]) {
  const raw = await request.text();
  if (raw.length > 8192) throw new TenantError(413, "payload_too_large");
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !fields.includes(k))) throw new TenantError(400, "invalid_payload");
  return data as Record<string, unknown>;
}
export async function handleWms(request: Request): Promise<Response> {
  const requestId = randomUUID(), headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    if (request.method !== "GET" && (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))) throw new TenantError(403, "invalid_origin");
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/wms\/?/, "").split("/").filter(Boolean);
    const [tenantId, root, parentId, child, childId] = path;
    if (!tenantId || !uuid(tenantId) || !["products", "warehouses"].includes(root) || path.length < 2 || path.length > 5 || parentId && !uuid(parentId) || childId && !uuid(childId)) throw new TenantError(404, "not_found");
    const limit = Number(url.searchParams.get("limit") ?? 20), offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
    const service = createWms(getDatabase()); let result: unknown, status = 200;
    if (path.length === 4 && root === "products" && child === "convert" && request.method === "POST") {
      const data = await payload(request, ["unitId", "quantity"]);
      if (typeof data.unitId !== "string" || !uuid(data.unitId)) throw new TenantError(400, "invalid_payload");
      result = await service.convert(session.user, tenantId, parentId, data.unitId, data.quantity as number);
    } else {
      let scope: WmsScope, id: string | undefined;
      if (path.length <= 3) { scope = { kind: root as "products" | "warehouses" }; id = parentId; }
      else if (root === "products" && child === "units") { scope = { kind: "units", parentId }; id = childId; }
      else if (root === "warehouses" && child === "locations") { scope = { kind: "locations", parentId }; id = childId; }
      else throw new TenantError(404, "not_found");
      if (request.method === "GET") result = id ? await service.detail(session.user, tenantId, scope, id) : await service.list(session.user, tenantId, scope, limit, offset);
      else if (request.method === "POST" && !id) {
        const data = await payload(request, ["code", "name", ...(scope.kind === "products" ? ["baseUnit"] : scope.kind === "units" ? ["factor"] : [])]);
        result = await service.create(session.user, tenantId, scope, { code: data.code as string, name: data.name as string, baseUnit: data.baseUnit as string, factor: data.factor as number }, requestId); status = 201;
      } else if (request.method === "PATCH" && id) {
        const data = await payload(request, ["name", "isActive", "version"]);
        result = await service.update(session.user, tenantId, scope, id, { name: data.name as string, isActive: data.isActive as boolean, version: data.version as number }, requestId);
      } else throw new TenantError(405, "method_not_allowed");
    }
    console.info(JSON.stringify({ event: "wms.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    const status = error instanceof TenantError ? error.status : duplicate ? 409 : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : duplicate ? "duplicate_code" : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    console.warn(JSON.stringify({ event: "wms.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
