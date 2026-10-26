import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase, deliverMail } from "../platform";
import { createTenancy, TenantError } from "./service";
import type { MembershipRole } from "../../generated/prisma/client";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new TenantError(400, "invalid_payload");
  return value as Record<string, unknown>;
}
function role(value: unknown): MembershipRole {
  if (value !== "owner" && value !== "member") throw new TenantError(400, "invalid_role");
  return value;
}

export async function handleTenancy(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    const config = readAuthConfig();
    if (request.method !== "GET" && (request.headers.get("origin") !== config.baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !request.headers.get("content-type")?.startsWith("application/json"))) throw new TenantError(403, "invalid_origin");
    const actor = session.user;
    const service = createTenancy(getDatabase(), deliverMail, config.baseURL);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/tenancy\/?/, "").split("/").filter(Boolean);
    const limit = Number(url.searchParams.get("limit") ?? 50); const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
    let result: unknown; let status = 200;
    if (request.method === "GET" && path.length === 0) result = await service.list(actor, limit, offset);
    else if (request.method === "POST" && path.join("/") === "accept") {
      const data = object(await request.json(), ["token"]);
      if (typeof data.token !== "string") throw new TenantError(400, "invalid_payload");
      result = await service.accept(actor, data.token, requestId);
    } else {
      const [tenantId, resource, target] = path;
      if (!tenantId || !uuid(tenantId) || path.length > 3 || (target && !uuid(target))) throw new TenantError(404, "not_found");
      if (request.method === "GET" && path.length === 1) result = await service.detail(actor, tenantId);
      else if (request.method === "GET" && path.length === 2 && resource === "members") result = await service.members(actor, tenantId, limit, offset);
      else if (request.method === "GET" && path.length === 2 && resource === "invitations") result = await service.invitations(actor, tenantId, limit, offset);
      else if (request.method === "GET" && path.length === 2 && resource === "audit") result = await service.events(actor, tenantId, limit, offset);
      else if (request.method === "PATCH" && path.length === 3 && resource === "members") {
        const data = object(await request.json(), ["role", "isActive"]);
        if (!Object.keys(data).length || (data.isActive !== undefined && typeof data.isActive !== "boolean")) throw new TenantError(400, "invalid_payload");
        result = await service.changeMember(actor, tenantId, target, { ...(data.role === undefined ? {} : { role: role(data.role) }), ...(data.isActive === undefined ? {} : { isActive: data.isActive as boolean }) }, requestId);
      } else if (request.method === "POST" && path.length === 2 && resource === "invitations") {
        const data = object(await request.json(), ["email", "role"]);
        if (typeof data.email !== "string") throw new TenantError(400, "invalid_payload");
        result = await service.invite(actor, tenantId, data.email, role(data.role ?? "member"), requestId); status = 201;
      } else if (request.method === "POST" && path.length === 3 && resource === "invitations") {
        object(await request.json(), []);
        result = await service.revoke(actor, tenantId, target, requestId);
      } else throw new TenantError(405, "method_not_allowed");
    }
    console.info(JSON.stringify({ event: "tenancy.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } });
  } catch (error) {
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    console.warn(JSON.stringify({ event: "tenancy.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } });
  }
}
