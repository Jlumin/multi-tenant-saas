import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createStock } from "./stock-service";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function body(request: Request, allowed: string[]) {
  const raw = await request.text();
  if (raw.length > 65536) throw new TenantError(413, "payload_too_large");
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) throw new TenantError(400, "invalid_payload");
  return data as Record<string, unknown>;
}
function page(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? 20), offset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
  return { limit, offset };
}
function optionalId(value: string | null, field: string) {
  if (value !== null && !uuid(value)) throw new TenantError(400, `invalid_${field}`);
  return value ?? undefined;
}
export async function handleStock(request: Request): Promise<Response> {
  const requestId = randomUUID(), headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    if (request.method !== "GET" && (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))) throw new TenantError(403, "invalid_origin");
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/wms-stock\/?/, "").split("/").filter(Boolean);
    const [tenantId, resource, id, action] = path;
    if (!tenantId || !uuid(tenantId) || path.length < 2 || path.length > 4 || (id && !uuid(id)) || !["documents", "balances", "movements"].includes(resource)) throw new TenantError(404, "not_found");
    const { limit, offset } = page(url), service = createStock(getDatabase());
    let result: unknown, status = 200;
    if (resource === "documents" && path.length === 2 && request.method === "GET") {
      const type = url.searchParams.get("type"), state = url.searchParams.get("status");
      if (type && type !== "inbound" && type !== "outbound" || state && !["draft", "posted", "cancelled"].includes(state)) throw new TenantError(400, "invalid_filter");
      result = await service.listDocuments(session.user, tenantId, { ...(type ? { type: type as "inbound" | "outbound" } : {}), ...(state ? { status: state as "draft" | "posted" | "cancelled" } : {}) }, limit, offset);
    } else if (resource === "documents" && path.length === 2 && request.method === "POST") {
      const data = await body(request, ["type", "warehouseId", "memo", "lines"]);
      if (data.type !== "inbound" && data.type !== "outbound") throw new TenantError(400, "invalid_type");
      result = await service.createDraft(session.user, tenantId, data.type, { warehouseId: data.warehouseId as string, memo: data.memo as string | undefined, lines: data.lines as never }, requestId); status = 201;
    } else if (resource === "documents" && path.length === 3 && request.method === "GET") result = await service.getDocument(session.user, tenantId, id);
    else if (resource === "documents" && path.length === 3 && request.method === "PATCH") {
      const data = await body(request, ["version", "memo", "lines"]);
      result = await service.updateDraft(session.user, tenantId, id, data.version as number, { memo: data.memo as string | undefined, lines: data.lines as never }, requestId);
    } else if (resource === "documents" && path.length === 4 && action === "cancel" && request.method === "POST") {
      const data = await body(request, ["version"]);
      result = await service.cancelDraft(session.user, tenantId, id, data.version as number, requestId);
    } else if (resource === "documents" && path.length === 4 && action === "post" && request.method === "POST") {
      const data = await body(request, ["version"]), key = request.headers.get("idempotency-key") ?? "";
      result = await service.post(session.user, tenantId, id, data.version as number, key, requestId);
    } else if (resource === "balances" && path.length === 2 && request.method === "GET") {
      result = await service.balances(session.user, tenantId, { productId: optionalId(url.searchParams.get("productId"), "product"), warehouseId: optionalId(url.searchParams.get("warehouseId"), "warehouse"), locationId: optionalId(url.searchParams.get("locationId"), "location") }, limit, offset);
    } else if (resource === "movements" && path.length === 2 && request.method === "GET") {
      result = await service.movements(session.user, tenantId, { productId: optionalId(url.searchParams.get("productId"), "product"), warehouseId: optionalId(url.searchParams.get("warehouseId"), "warehouse"), locationId: optionalId(url.searchParams.get("locationId"), "location") }, limit, offset);
    } else throw new TenantError(405, "method_not_allowed");
    console.info(JSON.stringify({ event: "wms.stock.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    const status = error instanceof TenantError ? error.status : duplicate ? 409 : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : duplicate ? "duplicate_code" : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    console.warn(JSON.stringify({ event: "wms.stock.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
