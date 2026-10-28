import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createStock } from "./stock-service";
import { createStockCounts } from "./count-service";
import { createRestockNotifications } from "../ecommerce/restock";

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
    if (!tenantId || !uuid(tenantId) || path.length < 2 || path.length > 5 || (id && !uuid(id)) || !["documents", "balances", "movements", "counts", "settings"].includes(resource)) throw new TenantError(404, "not_found");
    const { limit, offset } = page(url), database = getDatabase(), service = createStock(database), counts = createStockCounts(database);
    let result: unknown, status = 200;
    if (resource === "settings" && path.length === 2 && request.method === "GET") result = await service.settings(session.user, tenantId);
    else if (resource === "settings" && path.length === 2 && request.method === "PATCH") {
      const data = await body(request, ["allowInterWarehouseTransfers", "version"]);
      result = await service.updateSettings(session.user, tenantId, data as { allowInterWarehouseTransfers: boolean; version: number }, requestId);
    } else if (resource === "documents" && path.length === 2 && request.method === "GET") {
      const type = url.searchParams.get("type"), state = url.searchParams.get("status");
      if (type && !["inbound", "outbound", "transfer", "opening", "adjustment"].includes(type) || state && !["draft", "posted", "cancelled"].includes(state)) throw new TenantError(400, "invalid_filter");
      result = await service.listDocuments(session.user, tenantId, { ...(type ? { type: type as "inbound" | "outbound" | "transfer" | "opening" | "adjustment" } : {}), ...(state ? { status: state as "draft" | "posted" | "cancelled" } : {}) }, limit, offset);
    } else if (resource === "documents" && path.length === 2 && request.method === "POST") {
      const data = await body(request, ["type", "warehouseId", "destinationWarehouseId", "memo", "lines"]);
      if (data.type !== "inbound" && data.type !== "outbound" && data.type !== "transfer" && data.type !== "opening") throw new TenantError(400, "invalid_type");
      result = await service.createDraft(session.user, tenantId, data.type, { warehouseId: data.warehouseId as string, destinationWarehouseId: data.destinationWarehouseId as string | undefined, memo: data.memo as string | undefined, lines: data.lines as never }, requestId); status = 201;
    } else if (resource === "documents" && path.length === 3 && request.method === "GET") result = await service.getDocument(session.user, tenantId, id);
    else if (resource === "documents" && path.length === 3 && request.method === "PATCH") {
      const data = await body(request, ["version", "memo", "lines", "destinationWarehouseId"]);
      result = await service.updateDraft(session.user, tenantId, id, data.version as number, { memo: data.memo as string | undefined, lines: data.lines as never, destinationWarehouseId: data.destinationWarehouseId as string | undefined }, requestId);
    } else if (resource === "documents" && path.length === 4 && action === "cancel" && request.method === "POST") {
      const data = await body(request, ["version"]);
      result = await service.cancelDraft(session.user, tenantId, id, data.version as number, requestId);
    } else if (resource === "documents" && path.length === 4 && action === "post" && request.method === "POST") {
      const data = await body(request, ["version"]), key = request.headers.get("idempotency-key") ?? "";
      result = await service.post(session.user, tenantId, id, data.version as number, key, requestId);
      const posted = result as { type?: string; status?: string; warehouseId?: string; lines?: Array<{ productId: string }> };
      if (posted.status === "posted" && (posted.type === "inbound" || posted.type === "opening") && posted.warehouseId) {
        try { await createRestockNotifications(database).notifyRestocked(tenantId, posted.warehouseId, [...new Set((posted.lines ?? []).map(line => line.productId))]); }
        catch { console.error(JSON.stringify({ event: "ecommerce.restock_notification.retryable_failure", requestId })); }
      }
    } else if (resource === "documents" && path.length === 4 && action === "reverse" && request.method === "POST") {
      const data = await body(request, ["reason"]), key = request.headers.get("idempotency-key") ?? "";
      result = await service.reverse(session.user, tenantId, id, data.reason, key, requestId); status = 201;
    } else if (resource === "movements" && path.length === 3 && request.method === "GET") result = await service.getMovement(session.user, tenantId, id);
    else if (resource === "counts" && path.length === 2 && request.method === "GET") {
      result = await counts.list(session.user, tenantId, optionalId(url.searchParams.get("warehouseId"), "warehouse"), limit, offset);
    } else if (resource === "counts" && path.length === 2 && request.method === "POST") {
      const data = await body(request, ["warehouseId", "memo"]);
      result = await counts.start(session.user, tenantId, data.warehouseId as string, data.memo as string | undefined, requestId); status = 201;
    } else if (resource === "counts" && path.length === 3 && request.method === "GET") result = await counts.get(session.user, tenantId, id);
    else if (resource === "counts" && path.length === 4 && action === "lines" && request.method === "POST") {
      const data = await body(request, ["version", "productId", "locationId"]);
      result = await counts.addLine(session.user, tenantId, id, data.productId as string, data.locationId as string, data.version as number, requestId);
    } else if (resource === "counts" && path.length === 5 && action === "lines" && request.method === "PATCH") {
      const lineId = path[4]; if (!uuid(lineId)) throw new TenantError(404, "not_found");
      const data = await body(request, ["version", "countedQuantity", "reason"]);
      result = await counts.setLine(session.user, tenantId, id, lineId, data.version as number, data.countedQuantity as number, data.reason as string | undefined, requestId);
    } else if (resource === "counts" && path.length === 4 && action === "cancel" && request.method === "POST") {
      const data = await body(request, ["version"]);
      result = await counts.cancel(session.user, tenantId, id, data.version as number, requestId);
    } else if (resource === "counts" && path.length === 4 && action === "post" && request.method === "POST") {
      const data = await body(request, ["version"]), key = request.headers.get("idempotency-key") ?? "";
      result = await counts.post(session.user, tenantId, id, data.version as number, key, requestId);
      if (typeof result === "object" && result !== null && "stale" in result && result.stale === true) status = 409;
    }
    else if (resource === "balances" && path.length === 2 && request.method === "GET") {
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
