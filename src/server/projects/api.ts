import { randomUUID } from "node:crypto";
import { getAuth } from "../auth/runtime";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createProjects } from "./service";

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function payload(request: Request, fields: string[]) {
  const text = await request.text();
  if (text.length > 16384) throw new TenantError(413, "payload_too_large");
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !fields.includes(k))) throw new TenantError(400, "invalid_payload");
  return data as Record<string, unknown>;
}
export async function handleProjects(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) throw new TenantError(401, "unauthenticated");
    if (request.method !== "GET" && (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))) throw new TenantError(403, "invalid_origin");
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/projects\/?/, "").split("/").filter(Boolean);
    if (path.length < 1 || path.length > 2 || path.some(p => !uuid(p))) throw new TenantError(404, "not_found");
    const [tenantId, projectId] = path;
    const limit = Number(url.searchParams.get("limit") ?? 20), offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
    const service = createProjects(getDatabase());
    let result: unknown; let status = 200;
    if (request.method === "GET") result = projectId ? await service.detail(session.user, tenantId, projectId) : await service.list(session.user, tenantId, limit, offset);
    else if (request.method === "POST" && !projectId || request.method === "PATCH" && projectId) {
      const data = await payload(request, request.method === "POST" ? ["name", "description"] : ["name", "description", "version"]);
      if (typeof data.name !== "string" || (data.description !== undefined && typeof data.description !== "string")) throw new TenantError(400, "invalid_payload");
      const input = { name: data.name, description: data.description as string ?? "" };
      if (request.method === "POST") { result = await service.create(session.user, tenantId, input, requestId); status = 201; }
      else result = await service.update(session.user, tenantId, projectId, input, data.version as number, requestId);
    } else if (request.method === "DELETE" && projectId) {
      const data = await payload(request, ["version"]);
      result = await service.remove(session.user, tenantId, projectId, data.version as number, requestId);
    } else throw new TenantError(405, "method_not_allowed");
    console.info(JSON.stringify({ event: "projects.request", requestId, method: request.method, status }));
    return Response.json(result, { status, headers });
  } catch (error) {
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    console.warn(JSON.stringify({ event: "projects.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
