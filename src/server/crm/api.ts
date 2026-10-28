import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createCrm } from "./service";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function payload(request: Request, fields: string[]) {
  const text = await request.text(); if (text.length > 16384) throw new TenantError(413, "payload_too_large");
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !fields.includes(key))) throw new TenantError(400, "invalid_payload");
  return data as Record<string, unknown>;
}

export async function handleCrm(request: Request): Promise<Response> {
  const requestId = randomUUID(), headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    if (request.method !== "GET" && (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))) throw new TenantError(403, "invalid_origin");
    const parts = new URL(request.url).pathname.replace(/^\/api\/crm\/?/, "").split("/").filter(Boolean);
    if (parts.length < 2 || parts.length > 4 || !uuid(parts[0]) || parts[1] !== "contacts" || (parts[2] && !uuid(parts[2])) || (parts[3] && parts[3] !== "archive")) throw new TenantError(404, "not_found");
    const [tenantId, , contactId, action] = parts;
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    const service = createCrm(getDatabase()), actor = session.user, url = new URL(request.url);
    let result: unknown, status = 200;
    if (request.method === "GET" && parts.length === 2) {
      const limit = Number(url.searchParams.get("limit") ?? 50), offset = Number(url.searchParams.get("offset") ?? 0), query = url.searchParams.get("q") ?? "";
      result = await service.list(actor, tenantId, query, limit, offset);
    } else if (request.method === "GET" && contactId && parts.length === 3) result = await service.get(actor, tenantId, contactId);
    else if (request.method === "POST" && parts.length === 2) {
      const data = await payload(request, ["displayName", "email", "phone", "notes"]);
      result = await service.create(actor, tenantId, data as never, requestId); status = 201;
    } else if (request.method === "PATCH" && contactId && parts.length === 3) {
      const data = await payload(request, ["displayName", "email", "phone", "notes", "version"]);
      result = await service.update(actor, tenantId, contactId, data as never, requestId);
    } else if (request.method === "POST" && contactId && action === "archive" && parts.length === 4) {
      const data = await payload(request, ["version"]);
      result = await service.archive(actor, tenantId, contactId, data.version as number, requestId);
    } else throw new TenantError(405, "method_not_allowed");
    console.info(JSON.stringify({ event: "crm.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers });
  } catch (error) {
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    console.warn(JSON.stringify({ event: "crm.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
