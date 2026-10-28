import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createHr } from "./service";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function payload(request: Request, fields: string[]) {
  const text = await request.text();
  if (text.length > 16384) throw new TenantError(413, "payload_too_large");
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !fields.includes(key))) throw new TenantError(400, "invalid_payload");
  return data as Record<string, unknown>;
}

export async function handleHr(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    if (request.method !== "GET" && (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))) throw new TenantError(403, "invalid_origin");
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/hr\/?/, "").split("/").filter(Boolean);
    if (path.length < 2 || path.length > 4 || !uuid(path[0]) || path.some((part, i) => i > 0 && part !== "employees" && part !== "attendance" && part !== "clock-in" && part !== "clock-out" && part !== "settings" && part !== "current" && !uuid(part) && part !== "adjust")) throw new TenantError(404, "not_found");
    const [tenantId, resource, id, action] = path;
    const limit = Number(url.searchParams.get("limit") ?? 50), offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
    const service = createHr(getDatabase());
    let result: unknown; let status = 200;
    if (request.method === "GET" && resource === "employees" && !id) result = await service.employees(session.user, tenantId, limit, offset);
    else if (request.method === "GET" && resource === "attendance" && !id) {
      const userId = url.searchParams.get("userId") ?? undefined;
      if (userId && !uuid(userId)) throw new TenantError(400, "invalid_user");
      result = await service.history(session.user, tenantId, limit, offset, userId);
    } else if (request.method === "GET" && resource === "current") result = await service.current(session.user, tenantId);
    else if (request.method === "GET" && resource === "settings") result = await service.settings(session.user, tenantId);
    else if (request.method === "POST" && resource === "employees" && !id) {
      const data = await payload(request, ["userId", "staffNumber"]);
      result = await service.createEmployee(session.user, tenantId, data as { userId: string; staffNumber: string }, requestId); status = 201;
    } else if (request.method === "PATCH" && resource === "employees" && id && !action) {
      const data = await payload(request, ["staffNumber", "isActive", "version"]);
      result = await service.updateEmployee(session.user, tenantId, id, data as { staffNumber: string; isActive: boolean; version: number }, requestId);
    } else if (request.method === "PATCH" && resource === "settings" && !id) {
      const data = await payload(request, ["timeZone"]);
      if (typeof data.timeZone !== "string") throw new TenantError(400, "invalid_payload");
      result = await service.setTimezone(session.user, tenantId, data.timeZone, requestId);
    } else if (request.method === "POST" && resource === "clock-in" && !id) {
      const data = await payload(request, ["idempotencyKey"]);
      if (typeof data.idempotencyKey !== "string") throw new TenantError(400, "invalid_payload");
      result = await service.clockIn(session.user, tenantId, data.idempotencyKey, requestId); status = 201;
    } else if (request.method === "POST" && resource === "clock-out" && !id) {
      const data = await payload(request, ["idempotencyKey"]);
      if (typeof data.idempotencyKey !== "string") throw new TenantError(400, "invalid_payload");
      result = await service.clockOut(session.user, tenantId, data.idempotencyKey, requestId);
    } else if (request.method === "POST" && resource === "attendance" && id && action === "adjust") {
      const data = await payload(request, ["field", "correctedAt", "reason"]);
      result = await service.adjust(session.user, tenantId, id, data.field as "clock_in" | "clock_out", data.correctedAt as string, data.reason as string, requestId);
    } else throw new TenantError(405, "method_not_allowed");
    console.info(JSON.stringify({ event: "hr.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers });
  } catch (error) {
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    console.warn(JSON.stringify({ event: "hr.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
